const express     = require('express');
const commissions = require('../services/commissions');
const licenses    = require('../services/licenses');
const files       = require('../services/files');
const db          = require('../db/database');
const { requireAuth } = require('./auth');

const router = express.Router();

/** Domain errors are the user's problem to fix, not a 500. */
function fail(res, err, status = 400) {
  return res.status(status).json({ error: err.message });
}

/**
 * Resolve a commission the caller is actually a party to. Someone who is not on
 * the deal gets the same 404 as a commission that does not exist, so the
 * endpoint cannot be used to probe for other people's commissions.
 */
function loadCommission(req, res, next) {
  const detail = commissions.detail(Number(req.params.id), req.currentUser);
  if (!detail) return res.status(404).json({ error: 'Commission not found' });
  req.commission = detail;
  next();
}

// POST /api/commissions/quote - price it before committing to anything
router.post('/quote', requireAuth, (req, res) => {
  const { photoId, painterId, priceCents } = req.body || {};
  try {
    res.json(commissions.quote({
      photoId: Number(photoId), painterId: Number(painterId),
      priceCents: Math.round(Number(priceCents) || 0),
    }));
  } catch (err) { fail(res, err); }
});

// POST /api/commissions
router.post('/', requireAuth, async (req, res) => {
  const { photoId, painterId, priceCents, medium, size, brief } = req.body || {};
  try {
    const result = await commissions.create({
      buyer: req.currentUser,
      photoId: Number(photoId), painterId: Number(painterId),
      priceCents: Math.round(Number(priceCents) || 0),
      medium, size, brief,
    });
    res.status(201).json(result);
  } catch (err) { fail(res, err); }
});

// GET /api/commissions?role=buyer|painter|photographer
router.get('/', requireAuth, (req, res) => {
  res.json(commissions.listFor(req.currentUser, { role: req.query.role }));
});

// GET /api/commissions/:id
router.get('/:id', requireAuth, loadCommission, (req, res) => res.json(req.commission));

/**
 * POST /api/commissions/:id/confirm-payment
 * The browser calls this on return from checkout. It re-checks with the payment
 * provider rather than believing the caller, so a forged call proves nothing.
 */
router.post('/:id/confirm-payment', requireAuth, loadCommission, async (req, res) => {
  try {
    await commissions.confirmFunding(req.commission.id);
    res.json(commissions.detail(req.commission.id, req.currentUser));
  } catch (err) { fail(res, err); }
});

// POST /api/commissions/:id/sign - sign the licence as whichever party you are
router.post('/:id/sign', requireAuth, loadCommission, (req, res) => {
  try {
    const { license } = commissions.signLicense(req.commission.id, {
      user: req.currentUser,
      typedName: req.body?.typedName,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    res.json({ license, commission: commissions.detail(req.commission.id, req.currentUser) });
  } catch (err) { fail(res, err); }
});

// POST /api/commissions/:id/deliver
router.post('/:id/deliver', requireAuth, loadCommission, (req, res) => {
  try {
    commissions.deliver(req.commission.id, {
      user: req.currentUser, note: req.body?.note, images: req.body?.images || [],
    });
    res.json(commissions.detail(req.commission.id, req.currentUser));
  } catch (err) { fail(res, err); }
});

// POST /api/commissions/:id/accept - releases escrow and issues the certificate
router.post('/:id/accept', requireAuth, loadCommission, async (req, res) => {
  try {
    await commissions.accept(req.commission.id, { user: req.currentUser });
    res.json(commissions.detail(req.commission.id, req.currentUser));
  } catch (err) { fail(res, err); }
});

// POST /api/commissions/:id/dispute
router.post('/:id/dispute', requireAuth, loadCommission, (req, res) => {
  try {
    commissions.dispute(req.commission.id, { user: req.currentUser, reason: req.body?.reason });
    res.json(commissions.detail(req.commission.id, req.currentUser));
  } catch (err) { fail(res, err); }
});

// POST /api/commissions/:id/cancel
router.post('/:id/cancel', requireAuth, loadCommission, (req, res) => {
  try {
    commissions.cancel(req.commission.id, { user: req.currentUser, reason: req.body?.reason });
    res.json(commissions.detail(req.commission.id, req.currentUser));
  } catch (err) { fail(res, err); }
});

// POST /api/commissions/:id/refund
router.post('/:id/refund', requireAuth, loadCommission, async (req, res) => {
  try {
    await commissions.refund(req.commission.id, { user: req.currentUser, reason: req.body?.reason });
    res.json(commissions.detail(req.commission.id, req.currentUser));
  } catch (err) { fail(res, err); }
});

// PATCH /api/commissions/:id/milestones/:milestoneId - painter's progress updates
router.patch('/:id/milestones/:milestoneId', requireAuth, loadCommission, (req, res) => {
  const commission = commissions.get(req.commission.id);
  if (req.commission.role !== 'painter') {
    return res.status(403).json({ error: 'Only the painter updates milestones' });
  }

  const milestone = db.prepare('SELECT * FROM milestones WHERE id = ? AND commission_id = ?')
    .get(Number(req.params.milestoneId), commission.id);
  if (!milestone) return res.status(404).json({ error: 'Milestone not found' });

  const complete = req.body?.complete !== false;
  db.prepare(`UPDATE milestones SET state = ?, note = COALESCE(?, note), completed_at = ? WHERE id = ?`)
    .run(complete ? 'complete' : 'pending', req.body?.note ?? null,
         complete ? new Date().toISOString() : null, milestone.id);

  commissions.logEvent(commission.id, commission.state, commission.state, req.currentUser.id, 'painter',
    `Milestone: ${milestone.label}${complete ? ' complete' : ' reopened'}`);

  res.json(commissions.detail(commission.id, req.currentUser));
});

// GET /api/commissions/:id/license.pdf
router.get('/:id/license.pdf', requireAuth, loadCommission, (req, res) => {
  const detail = req.commission;
  if (!detail.license?.pdf_file || !files.exists(detail.license.pdf_file)) {
    return res.status(404).json({ error: 'No licence has been issued for this commission yet' });
  }

  res.type('application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${licenses.licenseNumber(detail.license.id)}.pdf"`);
  res.send(files.read(detail.license.pdf_file));
});

module.exports = router;
