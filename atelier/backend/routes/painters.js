const express = require('express');
const db      = require('../db/database');
const { requireAuth, requireRole } = require('./auth');

const router = express.Router();

function publicPainter(row) {
  return {
    id: row.user_id ?? row.id,
    name: row.name,
    bio: row.bio,
    mediums: JSON.parse(row.mediums || '[]'),
    minPriceCents: row.min_price_cents || 0,
    maxPriceCents: row.max_price_cents || null,
    turnaroundDays: row.turnaround_days,
    accepting: Boolean(row.accepting),
    location: row.location,
    portfolio: JSON.parse(row.portfolio || '[]'),
    payoutsEnabled: Boolean(row.payouts_enabled),
    completed: row.completed ?? 0,
  };
}

// GET /api/painters - the directory a buyer picks from
router.get('/', (req, res) => {
  const { medium, maxPrice, accepting } = req.query;

  const rows = db.prepare(`
    SELECT pp.*, u.id AS user_id, u.name, u.payouts_enabled,
           (SELECT COUNT(*) FROM commissions c WHERE c.painter_id = u.id AND c.state = 'settled') AS completed
      FROM painter_profiles pp
      JOIN users u ON u.id = pp.user_id
     WHERE (? = '' OR pp.mediums LIKE '%' || ? || '%')
       AND (? = '' OR pp.min_price_cents <= CAST(? AS INTEGER))
       AND (? = '' OR pp.accepting = 1)
     ORDER BY pp.accepting DESC, completed DESC, u.name ASC
  `).all(medium || '', medium || '',
         maxPrice || '', maxPrice || '0',
         accepting ? '1' : '');

  res.json(rows.map(publicPainter));
});

// GET /api/painters/:id
router.get('/:id', (req, res) => {
  const row = db.prepare(`
    SELECT pp.*, u.id AS user_id, u.name, u.payouts_enabled,
           (SELECT COUNT(*) FROM commissions c WHERE c.painter_id = u.id AND c.state = 'settled') AS completed
      FROM painter_profiles pp JOIN users u ON u.id = pp.user_id
     WHERE pp.user_id = ?
  `).get(req.params.id);

  if (!row) return res.status(404).json({ error: 'Painter not found' });
  res.json(publicPainter(row));
});

// PUT /api/painters/me - the painter's own profile
router.put('/me', requireAuth, requireRole('painter'), (req, res) => {
  const { bio, mediums, minPriceCents, maxPriceCents, turnaroundDays, accepting, location, portfolio } = req.body || {};

  const min = minPriceCents === undefined ? undefined : Math.max(0, Math.round(Number(minPriceCents) || 0));
  const max = maxPriceCents === undefined || maxPriceCents === null || maxPriceCents === ''
    ? undefined : Math.max(0, Math.round(Number(maxPriceCents) || 0));

  if (min !== undefined && max !== undefined && max && max < min) {
    return res.status(400).json({ error: 'Your maximum cannot be below your minimum' });
  }

  db.prepare(`
    INSERT INTO painter_profiles (user_id, bio, mediums, min_price_cents, max_price_cents, turnaround_days, accepting, location, portfolio, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      bio = COALESCE(excluded.bio, painter_profiles.bio),
      mediums = COALESCE(excluded.mediums, painter_profiles.mediums),
      min_price_cents = COALESCE(excluded.min_price_cents, painter_profiles.min_price_cents),
      max_price_cents = COALESCE(excluded.max_price_cents, painter_profiles.max_price_cents),
      turnaround_days = COALESCE(excluded.turnaround_days, painter_profiles.turnaround_days),
      accepting = COALESCE(excluded.accepting, painter_profiles.accepting),
      location = COALESCE(excluded.location, painter_profiles.location),
      portfolio = COALESCE(excluded.portfolio, painter_profiles.portfolio),
      updated_at = datetime('now')
  `).run(req.currentUser.id,
         bio ?? null,
         mediums ? JSON.stringify(Array.isArray(mediums) ? mediums : String(mediums).split(',').map(m => m.trim()).filter(Boolean)) : null,
         min ?? null, max ?? null,
         turnaroundDays === undefined ? null : Math.max(1, Math.round(Number(turnaroundDays) || 30)),
         accepting === undefined ? null : (accepting ? 1 : 0),
         location ?? null,
         portfolio ? JSON.stringify(portfolio) : null);

  const row = db.prepare(`
    SELECT pp.*, u.id AS user_id, u.name, u.payouts_enabled, 0 AS completed
      FROM painter_profiles pp JOIN users u ON u.id = pp.user_id WHERE pp.user_id = ?
  `).get(req.currentUser.id);

  res.json(publicPainter(row));
});

module.exports = router;
