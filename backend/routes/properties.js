const express = require('express');
const db = require('../db/database');
const { requireAuth } = require('./auth');

const router = express.Router();

// GET /api/properties - list with filtering, sorting, pagination
router.get('/', requireAuth, (req, res) => {
  const {
    // Filters
    zip_code,          // comma-separated list
    sale_type,         // comma-separated list
    property_type,     // comma-separated list
    status,            // comma-separated list
    min_price,
    max_price,
    min_beds,
    min_baths,
    min_sqft,
    max_sqft,
    auction_date_from,
    auction_date_to,
    list_date_from,
    list_date_to,
    has_auction_date,  // 'true' | 'false'
    city,              // comma-separated
    // Sort
    sort_by = 'list_date',   // price, list_date, auction_date, sqft, bedrooms
    sort_dir = 'desc',       // asc | desc
    // Pagination
    page = 1,
    per_page = 50,
    // Map bounds
    lat_min, lat_max, lng_min, lng_max,
  } = req.query;

  const conditions = [];
  const params = [];

  // Status filter (default to Active + Pending)
  if (status) {
    const statuses = status.split(',').map(s => s.trim());
    conditions.push(`status IN (${statuses.map(() => '?').join(',')})`);
    params.push(...statuses);
  } else {
    conditions.push(`status IN ('Active', 'Pending')`);
  }

  if (zip_code) {
    const zips = zip_code.split(',').map(z => z.trim()).filter(Boolean);
    if (zips.length > 0) {
      conditions.push(`zip_code IN (${zips.map(() => '?').join(',')})`);
      params.push(...zips);
    }
  }

  if (sale_type) {
    const types = sale_type.split(',').map(t => t.trim());
    conditions.push(`sale_type IN (${types.map(() => '?').join(',')})`);
    params.push(...types);
  }

  if (property_type) {
    const types = property_type.split(',').map(t => t.trim());
    conditions.push(`property_type IN (${types.map(() => '?').join(',')})`);
    params.push(...types);
  }

  if (city) {
    const cities = city.split(',').map(c => c.trim());
    conditions.push(`city IN (${cities.map(() => '?').join(',')})`);
    params.push(...cities);
  }

  if (min_price) { conditions.push('price >= ?'); params.push(parseFloat(min_price)); }
  if (max_price) { conditions.push('price <= ?'); params.push(parseFloat(max_price)); }
  if (min_beds)  { conditions.push('bedrooms >= ?'); params.push(parseInt(min_beds)); }
  if (min_baths) { conditions.push('bathrooms >= ?'); params.push(parseFloat(min_baths)); }
  if (min_sqft)  { conditions.push('sqft >= ?'); params.push(parseInt(min_sqft)); }
  if (max_sqft)  { conditions.push('sqft <= ?'); params.push(parseInt(max_sqft)); }

  if (auction_date_from) { conditions.push('auction_date >= ?'); params.push(auction_date_from); }
  if (auction_date_to)   { conditions.push('auction_date <= ?'); params.push(auction_date_to); }
  if (list_date_from)    { conditions.push('list_date >= ?'); params.push(list_date_from); }
  if (list_date_to)      { conditions.push('list_date <= ?'); params.push(list_date_to); }

  if (has_auction_date === 'true')  { conditions.push('auction_date IS NOT NULL'); }
  if (has_auction_date === 'false') { conditions.push('auction_date IS NULL'); }

  // Map bounds filter
  if (lat_min && lat_max && lng_min && lng_max) {
    conditions.push('lat BETWEEN ? AND ?');
    conditions.push('lng BETWEEN ? AND ?');
    params.push(parseFloat(lat_min), parseFloat(lat_max));
    params.push(parseFloat(lng_min), parseFloat(lng_max));
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Validate sort
  const allowedSort = ['price', 'list_date', 'auction_date', 'sqft', 'bedrooms', 'created_at'];
  const sortCol = allowedSort.includes(sort_by) ? sort_by : 'list_date';
  const sortDir = sort_dir === 'asc' ? 'ASC' : 'DESC';

  const offset = (Math.max(1, parseInt(page)) - 1) * Math.min(100, parseInt(per_page));
  const limit = Math.min(100, parseInt(per_page));

  const total = db.prepare(`SELECT COUNT(*) as count FROM properties ${where}`).get(...params).count;
  const rows = db.prepare(`
    SELECT * FROM properties ${where}
    ORDER BY ${sortCol} ${sortDir} NULLS LAST
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  // Parse images JSON
  const properties = rows.map(p => ({
    ...p,
    images: tryParseJSON(p.images, []),
  }));

  res.json({
    properties,
    total,
    page: parseInt(page),
    per_page: limit,
    pages: Math.ceil(total / limit),
  });
});

// GET /api/properties/map - lightweight endpoint for map markers (lat/lng/id/price/type only)
router.get('/map', requireAuth, (req, res) => {
  const { status = 'Active,Pending' } = req.query;
  const statuses = status.split(',');
  const placeholders = statuses.map(() => '?').join(',');

  const markers = db.prepare(`
    SELECT id, lat, lng, price, sale_type, property_type, address, zip_code, bedrooms, bathrooms, sqft
    FROM properties
    WHERE lat IS NOT NULL AND lng IS NOT NULL AND status IN (${placeholders})
  `).all(...statuses);

  res.json(markers);
});

// GET /api/properties/stats - summary stats for dashboard
router.get('/stats', requireAuth, (req, res) => {
  const stats = {
    total_active: db.prepare(`SELECT COUNT(*) as c FROM properties WHERE status='Active'`).get().c,
    total_pending: db.prepare(`SELECT COUNT(*) as c FROM properties WHERE status='Pending'`).get().c,
    by_sale_type: db.prepare(`
      SELECT sale_type, COUNT(*) as count, MIN(price) as min_price, AVG(price) as avg_price
      FROM properties WHERE status='Active' AND price IS NOT NULL
      GROUP BY sale_type ORDER BY count DESC
    `).all(),
    upcoming_auctions: db.prepare(`
      SELECT COUNT(*) as c FROM properties
      WHERE auction_date >= date('now') AND status='Active'
    `).get().c,
    avg_price: db.prepare(`
      SELECT AVG(price) as avg FROM properties WHERE status='Active' AND price IS NOT NULL
    `).get().avg,
    price_ranges: db.prepare(`
      SELECT
        SUM(CASE WHEN price < 75000 THEN 1 ELSE 0 END) as under_75k,
        SUM(CASE WHEN price >= 75000 AND price < 100000 THEN 1 ELSE 0 END) as "75k_100k",
        SUM(CASE WHEN price >= 100000 AND price < 150000 THEN 1 ELSE 0 END) as "100k_150k",
        SUM(CASE WHEN price >= 150000 THEN 1 ELSE 0 END) as over_150k
      FROM properties WHERE status='Active' AND price IS NOT NULL
    `).get(),
    by_zip: db.prepare(`
      SELECT zip_code, COUNT(*) as count, MIN(price) as min_price
      FROM properties WHERE status='Active' AND zip_code IS NOT NULL
      GROUP BY zip_code ORDER BY count DESC LIMIT 15
    `).all(),
    last_updated: db.prepare(`
      SELECT MAX(finished_at) as ts FROM scrape_log WHERE status='success'
    `).get()?.ts,
  };

  res.json(stats);
});

// GET /api/properties/filter-options - distinct values for filter dropdowns
router.get('/filter-options', requireAuth, (req, res) => {
  const options = {
    zip_codes: db.prepare(
      `SELECT DISTINCT zip_code FROM properties WHERE zip_code IS NOT NULL AND status IN ('Active','Pending') ORDER BY zip_code`
    ).all().map(r => r.zip_code),
    cities: db.prepare(
      `SELECT DISTINCT city FROM properties WHERE city IS NOT NULL AND status IN ('Active','Pending') ORDER BY city`
    ).all().map(r => r.city),
    sale_types: db.prepare(
      `SELECT DISTINCT sale_type FROM properties WHERE sale_type IS NOT NULL ORDER BY sale_type`
    ).all().map(r => r.sale_type),
    property_types: db.prepare(
      `SELECT DISTINCT property_type FROM properties WHERE property_type IS NOT NULL ORDER BY property_type`
    ).all().map(r => r.property_type),
  };
  res.json(options);
});

// GET /api/properties/:id - single property detail
router.get('/:id', requireAuth, (req, res) => {
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  if (!property) return res.status(404).json({ error: 'Property not found' });

  // Check if saved by current user
  const saved = db.prepare(
    'SELECT id, notes FROM saved_properties WHERE user_id = ? AND property_id = ?'
  ).get(req.user.userId, property.id);

  res.json({
    ...property,
    images: tryParseJSON(property.images, []),
    saved: !!saved,
    saved_notes: saved?.notes || null,
  });
});

// POST /api/properties/:id/save - toggle save
router.post('/:id/save', requireAuth, (req, res) => {
  const { notes } = req.body;
  const propertyId = parseInt(req.params.id);
  const userId = req.user.userId;

  const existing = db.prepare(
    'SELECT id FROM saved_properties WHERE user_id = ? AND property_id = ?'
  ).get(userId, propertyId);

  if (existing) {
    if (notes !== undefined) {
      db.prepare('UPDATE saved_properties SET notes = ? WHERE id = ?').run(notes, existing.id);
      return res.json({ saved: true, message: 'Notes updated' });
    }
    db.prepare('DELETE FROM saved_properties WHERE id = ?').run(existing.id);
    return res.json({ saved: false });
  }

  db.prepare(
    'INSERT INTO saved_properties (user_id, property_id, notes) VALUES (?, ?, ?)'
  ).run(userId, propertyId, notes || null);
  res.json({ saved: true });
});

// GET /api/properties/saved/list - user's saved properties
router.get('/saved/list', requireAuth, (req, res) => {
  const saved = db.prepare(`
    SELECT p.*, sp.notes as saved_notes, sp.created_at as saved_at
    FROM properties p
    JOIN saved_properties sp ON p.id = sp.property_id
    WHERE sp.user_id = ?
    ORDER BY sp.created_at DESC
  `).all(req.user.userId);

  res.json(saved.map(p => ({ ...p, images: tryParseJSON(p.images, []) })));
});

// DELETE /api/properties/saved/:id
router.delete('/saved/:id', requireAuth, (req, res) => {
  db.prepare(
    'DELETE FROM saved_properties WHERE user_id = ? AND property_id = ?'
  ).run(req.user.userId, parseInt(req.params.id));
  res.json({ saved: false });
});

function tryParseJSON(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

module.exports = router;
