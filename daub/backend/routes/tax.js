const express = require('express');
const db      = require('../db/database');
const files   = require('../services/files');
const tax     = require('../services/tax');
const { requireAuth, requireRole } = require('./auth');

const router = express.Router();

const currentTaxYear = () => new Date().getUTCFullYear();

// GET /api/tax/documents - what the platform has recorded paying you
router.get('/documents', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM tax_documents WHERE user_id = ? ORDER BY tax_year DESC').all(req.currentUser.id);
  res.json(rows.map(row => ({
    taxYear: row.tax_year, formType: row.form_type,
    grossCents: row.gross_cents, payoutCount: row.payout_count,
    thresholdCents: row.threshold_cents, reportable: Boolean(row.reportable),
    generatedAt: row.generated_at,
    pdfUrl: `/api/tax/documents/${row.tax_year}/pdf`,
  })));
});

/**
 * POST /api/tax/documents/:year - generate or refresh your own statement.
 * The current year is generated on demand because it is still moving.
 */
router.post('/documents/:year', requireAuth, (req, res) => {
  const year = Number(req.params.year);
  if (!Number.isInteger(year) || year < 2020 || year > currentTaxYear()) {
    return res.status(400).json({ error: `Pick a tax year between 2020 and ${currentTaxYear()}` });
  }
  const document = tax.generate(req.currentUser.id, year);
  res.json({
    taxYear: document.tax_year, grossCents: document.gross_cents,
    payoutCount: document.payout_count, thresholdCents: document.threshold_cents,
    reportable: Boolean(document.reportable),
    pdfUrl: `/api/tax/documents/${year}/pdf`,
  });
});

router.get('/documents/:year/pdf', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM tax_documents WHERE user_id = ? AND tax_year = ?')
    .get(req.currentUser.id, Number(req.params.year));
  if (!row || !files.exists(row.pdf_file)) return res.status(404).json({ error: 'No statement for that year yet' });

  res.type('application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${row.tax_year}-earnings.pdf"`);
  res.send(files.read(row.pdf_file));
});

// GET /api/tax/admin/:year - every payee and their total
router.get('/admin/:year', requireAuth, requireRole('admin'), (req, res) => {
  const year = Number(req.params.year);
  const config = require('../services/config');
  const threshold = config.thresholdCentsFor(year);
  res.json({
    taxYear: year,
    thresholdCents: threshold,
    payees: tax.payeesFor(year).map(p => ({
      userId: p.user_id, name: p.legal_name || p.name, email: p.email,
      taxIdOnFile: Boolean(p.tax_id_last4),
      grossCents: p.gross, payoutCount: p.payouts,
      reportable: p.gross >= threshold,
    })),
  });
});

// POST /api/tax/admin/:year/generate - run the whole year
router.post('/admin/:year/generate', requireAuth, requireRole('admin'), (req, res) => {
  const generated = tax.generateYear(Number(req.params.year));
  res.json({
    taxYear: Number(req.params.year),
    generated: generated.length,
    reportable: generated.filter(d => d.reportable).length,
  });
});

module.exports = router;
