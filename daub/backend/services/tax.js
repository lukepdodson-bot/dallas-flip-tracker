/**
 * Information returns.
 *
 * The platform is the merchant of record for the whole commission leg, so the
 * platform - not the photographer, not the painter - is responsible for the
 * annual return to each payee. Painters and photographers get a document; they
 * do not chase each other for one.
 *
 * The figures come from this system's own `payouts` table rather than from
 * Stripe, so the totals reconcile against what the commission records say was
 * released. With Stripe Connect in production, Stripe's 1099 service does the
 * filing; this module produces the platform's own reconciled statement of what
 * it believes it paid, which is what you check that filing against.
 *
 * THRESHOLDS MOVE. The 1099-NEC threshold rose from $600 to $2,000 for payments
 * after 2025-12-31, indexed thereafter. Both figures are configuration, and the
 * threshold actually applied is stored on each generated document so a later
 * change never silently rewrites last year's answer. Confirm with a CPA.
 */
const db     = require('../db/database');
const files  = require('./files');
const config = require('./config');
const { PdfDoc } = require('./pdf');
const { fmt }    = require('./money');

/** Gross released to one payee in a calendar year. */
function grossFor(userId, taxYear) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(amount_cents), 0) AS gross, COUNT(*) AS payouts
      FROM payouts
     WHERE user_id = ? AND state = 'paid'
       AND paid_at >= ? AND paid_at < ?
  `).get(userId, `${taxYear}-01-01`, `${taxYear + 1}-01-01`);
  return { grossCents: row.gross || 0, payoutCount: row.payouts || 0 };
}

/** Everyone the platform paid in a year, with their totals. */
function payeesFor(taxYear) {
  return db.prepare(`
    SELECT p.user_id AS user_id, u.name, u.email, u.legal_name, u.tax_id_last4,
           SUM(p.amount_cents) AS gross, COUNT(*) AS payouts
      FROM payouts p
      JOIN users u ON u.id = p.user_id
     WHERE p.state = 'paid' AND p.user_id IS NOT NULL
       AND p.paid_at >= ? AND p.paid_at < ?
     GROUP BY p.user_id
     ORDER BY gross DESC
  `).all(`${taxYear}-01-01`, `${taxYear + 1}-01-01`);
}

/**
 * Generate (or regenerate) a payee's annual statement. Returns the row whether
 * or not it clears the threshold - a payee below it still gets to see their
 * total, and the platform still needs the record.
 */
function generate(userId, taxYear) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('User not found');

  const { grossCents, payoutCount } = grossFor(userId, taxYear);
  const thresholdCents = config.thresholdCentsFor(taxYear);
  const reportable = grossCents >= thresholdCents ? 1 : 0;

  const pdfPath = renderStatement({ user, taxYear, grossCents, payoutCount, thresholdCents, reportable });

  db.prepare(`
    INSERT INTO tax_documents (user_id, tax_year, form_type, gross_cents, payout_count, threshold_cents, reportable, pdf_file, generated_at)
    VALUES (?, ?, '1099-NEC', ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, tax_year, form_type) DO UPDATE SET
      gross_cents = excluded.gross_cents, payout_count = excluded.payout_count,
      threshold_cents = excluded.threshold_cents, reportable = excluded.reportable,
      pdf_file = excluded.pdf_file, generated_at = excluded.generated_at
  `).run(userId, taxYear, grossCents, payoutCount, thresholdCents, reportable, pdfPath);

  return db.prepare('SELECT * FROM tax_documents WHERE user_id = ? AND tax_year = ? AND form_type = ?')
    .get(userId, taxYear, '1099-NEC');
}

/** Run the whole year. Returns one row per payee. */
function generateYear(taxYear) {
  return payeesFor(taxYear).map(payee => generate(payee.user_id, taxYear));
}

function renderStatement({ user, taxYear, grossCents, payoutCount, thresholdCents, reportable }) {
  const doc = new PdfDoc({
    title: `${taxYear} earnings statement`,
    subtitle: 'Platform record supporting Form 1099-NEC',
    footer: `${user.email}  -  tax year ${taxYear}`,
  });

  doc.text('This is the platform\'s own reconciled record of what it released to you in the calendar ' +
           'year. It is not itself a filed information return. Where a return is filed, this statement ' +
           'is what to check it against.', { size: 9, gray: 0.3, after: 8 });
  doc.rule();

  doc.heading('Payee', 12);
  doc.keyValue('Name', user.legal_name || user.name);
  doc.keyValue('Email', user.email);
  doc.keyValue('Taxpayer ID', user.tax_id_last4 ? `ending ${user.tax_id_last4}` : 'not on file');
  doc.spacer(8);

  doc.heading('Amounts released', 12);
  doc.keyValue('Gross paid', fmt(grossCents));
  doc.keyValue('Number of payouts', String(payoutCount));
  doc.keyValue('Reporting threshold applied', fmt(thresholdCents));
  doc.keyValue('Meets threshold', reportable ? 'Yes - a 1099-NEC is expected' : 'No - below threshold');
  doc.spacer(8);

  doc.heading('Commissions included', 12);
  const lines = db.prepare(`
    SELECT p.amount_cents, p.party, p.paid_at, p.commission_id, c.medium, c.size
      FROM payouts p LEFT JOIN commissions c ON c.id = p.commission_id
     WHERE p.user_id = ? AND p.state = 'paid' AND p.paid_at >= ? AND p.paid_at < ?
     ORDER BY p.paid_at ASC
  `).all(user.id, `${taxYear}-01-01`, `${taxYear + 1}-01-01`);

  if (!lines.length) doc.text('No payouts were released in this year.', { size: 10, gray: 0.4 });
  for (const line of lines) {
    doc.keyValue(
      `${String(line.paid_at).slice(0, 10)}  commission #${line.commission_id}`,
      `${fmt(line.amount_cents)}  (${line.party} share)`,
      { labelWidth: 230 }
    );
  }

  doc.spacer(10);
  doc.rule();
  doc.text('Thresholds and filing requirements change. This statement records the threshold applied at ' +
           'the time it was generated. It is not tax advice.', { size: 8, gray: 0.45 });

  return files.save('tax', `${taxYear}-${user.id}-1099NEC.pdf`, doc.toBuffer());
}

module.exports = { generate, generateYear, grossFor, payeesFor };
