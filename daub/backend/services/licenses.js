/**
 * Licence issue and execution.
 *
 * A licence is issued the moment escrow is funded, not when the painter starts
 * work, so the painter never has the image before the paperwork exists. It is
 * "executed" only when all three parties have signed; until then the painter
 * cannot download anything.
 */
const db        = require('../db/database');
const files     = require('./files');
const signing   = require('./signing');
const watermark = require('./watermark');
const { hashOf, sha256 } = require('./canonical');
const { templateFor }    = require('./licenseTemplates');
const { PdfDoc }         = require('./pdf');
const { fmt }            = require('./money');
const config             = require('./config');

const PARTIES = ['photographer', 'painter', 'buyer'];

function licenseNumber(id) {
  return `LIC-${String(id).padStart(6, '0')}`;
}

/**
 * Build the canonical terms for a commission. Everything a third party would
 * need to know what was agreed goes in here, because this object is what gets
 * hashed and signed - anything left out is not covered by the signatures.
 */
function buildTerms({ commission, photo, photographer, painter, buyer, watermarkId, template, governingLaw = 'Texas' }) {
  return {
    tier: template.tier,
    templateVersion: template.version,
    issuedAt: new Date().toISOString(),
    governingLaw,
    photo: {
      id: photo.id,
      title: photo.title,
      sha256: photo.licensed_sha256 || null,
      photographerId: photographer.id,
      photographerName: photographer.legal_name || photographer.name,
    },
    painter: { id: painter.id, name: painter.legal_name || painter.name },
    buyer:   { id: buyer.id,   name: buyer.legal_name   || buyer.name },
    commission: {
      id: commission.id,
      priceCents: commission.price_cents,
      medium: commission.medium || null,
      size: commission.size || null,
      splits: {
        painterCents: commission.painter_cents,
        photographerCents: commission.photographer_cents,
        platformCents: commission.platform_cents,
        photographerBps: commission.photographer_bps,
        platformBps: commission.platform_bps,
      },
    },
    scope: {
      paintings: 1,
      medium: commission.medium || null,
      size: commission.size || null,
      reproductionRights: false,
      exclusivity: 'none',
      rawDelivered: false,
    },
    watermarkId,
  };
}

/** Issue a pending licence against a funded commission. Caller supplies the tx. */
function issue({ commission, photo, photographer, painter, buyer, tier = 'single_use' }) {
  const template     = templateFor(tier);
  const watermarkId  = watermark.newWatermarkId();
  const terms        = buildTerms({ commission, photo, photographer, painter, buyer, watermarkId, template });
  const { canonical, hash } = hashOf(terms);

  const templateRow = db.prepare('SELECT id FROM license_templates WHERE tier = ? AND version = ?')
    .get(template.tier, template.version);

  const result = db.prepare(`
    INSERT INTO licenses (photo_id, licensee_id, buyer_id, photographer_id, commission_id,
                          tier, template_id, terms, terms_hash, watermark_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(photo.id, painter.id, buyer.id, photographer.id, commission.id,
         tier, templateRow?.id ?? null, canonical, hash, watermarkId);

  const licenseId = result.lastInsertRowid;
  const pdfPath = renderPdf(licenseId);
  db.prepare('UPDATE licenses SET pdf_file = ? WHERE id = ?').run(pdfPath, licenseId);

  return db.prepare('SELECT * FROM licenses WHERE id = ?').get(licenseId);
}

/**
 * Record one party's signature. Executes the licence once all three are in.
 * Signing is idempotent per party: the unique index refuses a second one.
 */
function sign(licenseId, { userId, party, typedName, ip, userAgent }) {
  if (!PARTIES.includes(party)) throw new Error(`Unknown signing party "${party}"`);

  const license = db.prepare('SELECT * FROM licenses WHERE id = ?').get(licenseId);
  if (!license) throw new Error('Licence not found');
  if (license.status === 'void') throw new Error('This licence has been voided');

  const expected = { photographer: license.photographer_id, painter: license.licensee_id, buyer: license.buyer_id };
  if (expected[party] !== userId) throw new Error(`You are not the ${party} on this licence`);

  const existing = db.prepare('SELECT id FROM license_signatures WHERE license_id = ? AND party = ?')
    .get(licenseId, party);
  if (existing) return status(licenseId);

  const name = String(typedName || '').trim();
  if (name.length < 2) throw new Error('Type your full name to sign');

  const signedAt = new Date().toISOString();
  const signatureHash = sha256([license.terms_hash, party, userId, name, signedAt].join('|'));

  db.prepare(`
    INSERT INTO license_signatures (license_id, party, user_id, typed_name, signed_at, ip, user_agent, signature_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(licenseId, party, userId, name, signedAt, ip || null, userAgent || null, signatureHash);

  const signatures = db.prepare('SELECT party FROM license_signatures WHERE license_id = ?').all(licenseId);
  if (signatures.length === PARTIES.length) {
    db.prepare(`UPDATE licenses SET status = 'executed', executed_at = ?, platform_signature = ? WHERE id = ?`)
      .run(new Date().toISOString(), signing.sign(license.terms_hash), licenseId);
    db.prepare('UPDATE licenses SET pdf_file = ? WHERE id = ?').run(renderPdf(licenseId), licenseId);
  } else {
    db.prepare('UPDATE licenses SET pdf_file = ? WHERE id = ?').run(renderPdf(licenseId), licenseId);
  }

  return status(licenseId);
}

function status(licenseId) {
  const license = db.prepare('SELECT * FROM licenses WHERE id = ?').get(licenseId);
  const signatures = db.prepare('SELECT party, typed_name, signed_at FROM license_signatures WHERE license_id = ?')
    .all(licenseId);
  const signed = signatures.map(s => s.party);
  return {
    ...license,
    number: licenseNumber(license.id),
    signatures,
    outstanding: PARTIES.filter(p => !signed.includes(p)),
    executed: license.status === 'executed',
  };
}

/** True only when the painter may actually pull the file. */
function canDownload(license, userId) {
  return license
    && license.status === 'executed'
    && license.licensee_id === userId;
}

// ── PDF rendering ────────────────────────────────────────────────────────────
function renderPdf(licenseId) {
  const license  = db.prepare('SELECT * FROM licenses WHERE id = ?').get(licenseId);
  const terms    = JSON.parse(license.terms);
  const template = templateFor(license.tier);
  const signatures = db.prepare('SELECT * FROM license_signatures WHERE license_id = ?').all(licenseId);
  const number   = licenseNumber(license.id);

  const doc = new PdfDoc({
    title: template.title,
    subtitle: `${number}  -  template ${template.version}  -  ` +
              (license.status === 'executed' ? `executed ${license.executed_at}` : 'AWAITING SIGNATURE'),
    footer: `${number}  -  ${config.publicUrl}/verify`,
  });

  doc.text(template.preamble, { size: 10, after: 6 });
  doc.rule();

  template.clauses.forEach(([heading, body], index) => {
    doc.clause(index + 1, `${heading}. ${body}`);
  });

  doc.pageBreak();
  doc.heading('Schedule A - particulars', 14);
  doc.keyValue('Licence number', number);
  doc.keyValue('Tier', 'Single-use - one painting, one buyer');
  doc.keyValue('Image', `${terms.photo.title} (photo #${terms.photo.id})`);
  doc.keyValue('Photographer', terms.photo.photographerName);
  doc.keyValue('Painter', terms.painter.name);
  doc.keyValue('Buyer', terms.buyer.name);
  doc.keyValue('Commission', `#${terms.commission.id}`);
  doc.keyValue('Medium', terms.commission.medium || 'as agreed');
  doc.keyValue('Size', terms.commission.size || 'as agreed');
  doc.keyValue('Reproduction rights', 'Not granted');
  doc.keyValue('Exclusivity', 'None - the Photographer may license this Image to others');
  doc.keyValue('RAW files', 'Not delivered under any tier');
  doc.keyValue('Governing law', terms.governingLaw);
  doc.spacer(6);

  doc.heading('Consideration', 12);
  doc.keyValue('Commission price', fmt(terms.commission.priceCents));
  doc.keyValue('To the Painter', fmt(terms.commission.splits.painterCents));
  doc.keyValue('To the Photographer', fmt(terms.commission.splits.photographerCents));
  doc.keyValue('Platform fee', fmt(terms.commission.splits.platformCents));
  doc.spacer(6);

  doc.heading('Integrity', 12);
  doc.text('The parties signed the terms whose canonical form hashes to the value below. Any ' +
           'alteration to this document changes that hash.', { size: 9, gray: 0.3 });
  doc.keyValue('Terms hash (SHA-256)', '');
  doc.mono(license.terms_hash);
  doc.keyValue('File identifier', '');
  doc.mono(license.watermark_id);
  if (license.platform_signature) {
    doc.keyValue('Platform countersignature (Ed25519)', '');
    doc.mono(license.platform_signature);
    doc.keyValue('Signing key id', signing.keyId());
  }

  doc.spacer(10);
  doc.heading('Execution', 14);
  for (const party of PARTIES) {
    const signature = signatures.find(s => s.party === party);
    const label = party[0].toUpperCase() + party.slice(1);
    doc.spacer(4);
    if (signature) {
      doc.text(`${label}: ${signature.typed_name}`, { size: 10, font: 'bold' });
      doc.text(`Signed electronically ${signature.signed_at}` + (signature.ip ? ` from ${signature.ip}` : ''),
               { size: 8, gray: 0.4 });
      doc.mono(signature.signature_hash);
    } else {
      doc.text(`${label}: ________________________________   NOT YET SIGNED`, { size: 10, gray: 0.45 });
    }
  }

  doc.spacer(10);
  doc.rule();
  doc.text('This document was generated by the Platform from the executed record. It is a working ' +
           'template and not legal advice; the parties are responsible for their own counsel.',
           { size: 8, gray: 0.45 });

  return files.save('licenses', `${number}.pdf`, doc.toBuffer());
}

module.exports = { issue, sign, status, canDownload, renderPdf, licenseNumber, buildTerms, PARTIES };
