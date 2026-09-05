/**
 * The authenticity registry.
 *
 * Every completed work gets a signed, publicly checkable, permanent entry naming
 * both creators, the licence it was made under, and its provenance. It is
 * marketed as provenance, not as an investment wrapper - Verisart and Arcual are
 * the unglamorous precedent, and nothing in the buyer-facing surface says NFT.
 *
 * DELIBERATELY NOT HERE: token-enforced resale royalties. A token cannot compel a
 * physical painting to move with it - the canvas goes at an estate sale while the
 * token sits in a wallet - and royalty enforcement collapsed even in pure-digital
 * markets once Blur removed them and OpenSea made them optional in 2023. There is
 * no US resale right, so this would be engineering a royalty the law does not
 * grant. Resale is captured instead by giving the buyer a free authenticated
 * resale listing, appended to this chain as a `resale` entry.
 *
 * An entry exists only if the deal ran through the platform. An off-platform
 * handshake produces nothing, which is the main switching cost.
 */
const crypto  = require('crypto');
const db      = require('../db/database');
const files   = require('./files');
const signing = require('./signing');
const config  = require('./config');
const { hashOf } = require('./canonical');
const { PdfDoc } = require('./pdf');
const { licenseNumber } = require('./licenses');

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';   // Crockford base32: no I, L, O, U

function newPublicId(year = new Date().getUTCFullYear()) {
  const bytes = crypto.randomBytes(6);
  let body = '';
  for (const byte of bytes) body += ALPHABET[byte % 32];
  return `DAB-${year}-${body.slice(0, 4)}-${body.slice(4)}`;
}

/**
 * Append an entry. `previousEntryHash` chains a resale onto the creation entry,
 * so the chain reads as a provenance history rather than a set of loose records.
 */
function createEntry({ artworkId, kind = 'creation', extra = {}, previousEntryHash = null }) {
  const artwork = db.prepare('SELECT * FROM artworks WHERE id = ?').get(artworkId);
  if (!artwork) throw new Error('Artwork not found');

  const license    = artwork.license_id ? db.prepare('SELECT * FROM licenses WHERE id = ?').get(artwork.license_id) : null;
  const commission = artwork.commission_id ? db.prepare('SELECT * FROM commissions WHERE id = ?').get(artwork.commission_id) : null;
  const painter      = db.prepare('SELECT id, name, legal_name FROM users WHERE id = ?').get(artwork.painter_id);
  const photographer = db.prepare('SELECT id, name, legal_name FROM users WHERE id = ?').get(artwork.photographer_id);
  const photo        = license ? db.prepare('SELECT id, title, licensed_sha256 FROM photos WHERE id = ?').get(license.photo_id) : null;

  const publicId = newPublicId();
  const content = {
    schema: 'daub.registry/v1',
    kind,
    publicId,
    issuedAt: new Date().toISOString(),
    previousEntryHash,
    artwork: {
      id: artwork.id,
      title: artwork.title,
      medium: artwork.medium || null,
      size: artwork.size || null,
      completedAt: artwork.completed_at,
    },
    creators: {
      painter:      { id: painter.id,      name: painter.legal_name      || painter.name },
      photographer: { id: photographer.id, name: photographer.legal_name || photographer.name },
    },
    source: photo ? { photoId: photo.id, title: photo.title, sha256: photo.licensed_sha256 || null } : null,
    license: license ? {
      number: licenseNumber(license.id),
      tier: license.tier,
      termsHash: license.terms_hash,
      executedAt: license.executed_at,
    } : null,
    commission: commission ? {
      id: commission.id,
      settledAt: commission.settled_at,
      // The price is deliberately absent: provenance, not a price index.
    } : null,
    ...extra,
  };

  const { canonical, hash } = hashOf(content);
  const signature = signing.sign(hash);

  const result = db.prepare(`
    INSERT INTO registry_entries (public_id, artwork_id, kind, previous_entry_hash, canonical, content_hash, signature, key_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(publicId, artworkId, kind, previousEntryHash, canonical, hash, signature, signing.keyId());

  const entryId = result.lastInsertRowid;
  const pdfPath = renderCertificate(entryId);
  return { ...db.prepare('SELECT * FROM registry_entries WHERE id = ?').get(entryId), certificate_file: pdfPath };
}

/**
 * Check an entry. Recomputes the digest from the stored canonical bytes rather
 * than trusting the stored digest, so a tampered database row fails here.
 */
function verify(publicId) {
  const entry = db.prepare('SELECT * FROM registry_entries WHERE public_id = ?').get(publicId);
  if (!entry) return { valid: false, reason: 'No entry with that certificate number' };

  const recomputed = crypto.createHash('sha256').update(entry.canonical).digest('hex');
  if (recomputed !== entry.content_hash) {
    return { valid: false, reason: 'Recorded content does not match its hash', publicId };
  }
  if (!signing.verify(entry.content_hash, entry.signature)) {
    return { valid: false, reason: 'Signature does not verify under the current registry key',
             publicId, keyId: entry.key_id };
  }

  return {
    valid: true,
    publicId,
    keyId: entry.key_id,
    contentHash: entry.content_hash,
    signature: entry.signature,
    issuedAt: entry.created_at,
    content: JSON.parse(entry.canonical),
  };
}

/** Creation entry plus any resale entries chained onto it, oldest first. */
function chainFor(artworkId) {
  return db.prepare('SELECT * FROM registry_entries WHERE artwork_id = ? ORDER BY id ASC')
    .all(artworkId)
    .map(entry => ({
      publicId: entry.public_id,
      kind: entry.kind,
      contentHash: entry.content_hash,
      previousEntryHash: entry.previous_entry_hash,
      createdAt: entry.created_at,
      content: JSON.parse(entry.canonical),
    }));
}

function renderCertificate(entryId) {
  const entry   = db.prepare('SELECT * FROM registry_entries WHERE id = ?').get(entryId);
  const content = JSON.parse(entry.canonical);
  const verifyUrl = `${config.publicUrl}/verify/${entry.public_id}`;

  const doc = new PdfDoc({
    title: 'Certificate of Authenticity',
    subtitle: content.kind === 'resale' ? 'Registry entry - resale' : 'Registry entry - creation',
    footer: `${entry.public_id}  -  ${verifyUrl}`,
  });

  doc.spacer(6);
  doc.text(content.artwork.title, { size: 20, font: 'bold' });
  doc.text([content.artwork.medium, content.artwork.size].filter(Boolean).join(', ') || 'Original painting',
           { size: 11, font: 'italic', gray: 0.35, after: 10 });
  doc.rule();

  doc.heading('The work', 12);
  doc.keyValue('Painted by', content.creators.painter.name);
  doc.keyValue('After a photograph by', content.creators.photographer.name);
  if (content.source) doc.keyValue('Source image', `${content.source.title} (photo #${content.source.photoId})`);
  doc.keyValue('Completed', String(content.artwork.completedAt || '').slice(0, 10));
  doc.spacer(8);

  doc.heading('Rights', 12);
  if (content.license) {
    doc.keyValue('Licence', `${content.license.number} - ${content.license.tier.replace('_', '-')}`);
    doc.keyValue('Executed', String(content.license.executedAt || '').slice(0, 10));
    doc.text('The painting was made under a licence signed by the photographer, the painter and the ' +
             'buyer before work began. The photographer retains copyright in the photograph; the painter ' +
             'holds copyright in the painting; the owner holds the physical work.',
             { size: 9, gray: 0.3 });
  } else {
    doc.text('No licence is attached to this entry.', { size: 9, gray: 0.3 });
  }
  doc.spacer(8);

  doc.heading('Verification', 12);
  doc.text(`Anyone can check this certificate at ${verifyUrl}`, { size: 10 });
  doc.keyValue('Certificate number', entry.public_id);
  doc.keyValue('Content hash (SHA-256)', '');
  doc.mono(entry.content_hash);
  doc.keyValue('Signature (Ed25519)', '');
  doc.mono(entry.signature);
  doc.keyValue('Registry key id', entry.key_id);
  if (entry.previous_entry_hash) {
    doc.keyValue('Previous entry', '');
    doc.mono(entry.previous_entry_hash);
  }

  doc.spacer(10);
  doc.rule();
  doc.text('This is a record of provenance and authorship. It is not a security, an investment ' +
           'instrument, or a claim on any future sale of this work.', { size: 8, gray: 0.45 });

  return files.save('certificates', `${entry.public_id}.pdf`, doc.toBuffer());
}

function certificatePath(publicId) {
  return `certificates/${publicId}.pdf`;
}

module.exports = { createEntry, verify, chainFor, renderCertificate, certificatePath, newPublicId };
