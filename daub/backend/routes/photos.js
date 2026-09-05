const express = require('express');
const multer  = require('multer');
const path    = require('path');
const db      = require('../db/database');
const files   = require('../services/files');
const images  = require('../services/images');
const watermark = require('../services/watermark');
const licenses  = require('../services/licenses');
const { SKUS }  = require('../db/schema');
const { requireAuth, requireRole, optionalAuth } = require('./auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 120 * 1024 * 1024 } });

// Only `commission` transacts today. The rest are stored so photographers can
// express what they are willing to license from the first upload, and so Leg B
// is a routing change rather than a migration.
const TRANSACTABLE = new Set(['commission']);

const CONTENT_TYPES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.tif': 'image/tiff', '.tiff': 'image/tiff',
};
const contentTypeFor = name => CONTENT_TYPES[path.extname(name || '').toLowerCase()] || 'application/octet-stream';

function skusFor(photoId) {
  const rows = db.prepare('SELECT sku, enabled, floor_price_cents FROM photo_skus WHERE photo_id = ?').all(photoId);
  const byName = Object.fromEntries(rows.map(r => [r.sku, r]));
  return SKUS.map(sku => ({
    sku,
    enabled: Boolean(byName[sku]?.enabled),
    floorPriceCents: byName[sku]?.floor_price_cents ?? 0,
    transactable: TRANSACTABLE.has(sku),
  }));
}

function publicPhoto(photo, { includePrivate = false } = {}) {
  return {
    id: photo.id,
    title: photo.title,
    description: photo.description,
    tags: JSON.parse(photo.tags || '[]'),
    orientation: photo.orientation,
    width: photo.width, height: photo.height,
    status: photo.status,
    shotForPainting: Boolean(photo.shot_for_painting),
    photographer: db.prepare('SELECT id, name FROM users WHERE id = ?').get(photo.photographer_id),
    displayUrl: photo.display_file ? `/api/photos/${photo.id}/display` : null,
    thumbUrl:   photo.thumb_file   ? `/api/photos/${photo.id}/thumb`   : null,
    skus: skusFor(photo.id),
    ...(includePrivate ? {
      hasLicensedFile: Boolean(photo.licensed_file),
      needsDisplayRendition: !photo.display_file,
      licensedSha256: photo.licensed_sha256,
    } : {}),
  };
}

// ── Browse ───────────────────────────────────────────────────────────────────

// GET /api/photos - the library. Only published images with a commission SKU on.
router.get('/', optionalAuth, (req, res) => {
  const { q, orientation, tag, shotForPainting } = req.query;

  const rows = db.prepare(`
    SELECT p.* FROM photos p
      JOIN photo_skus s ON s.photo_id = p.id AND s.sku = 'commission' AND s.enabled = 1
     WHERE p.status = 'published'
       AND (? = '' OR p.title LIKE '%' || ? || '%' OR p.description LIKE '%' || ? || '%' OR p.tags LIKE '%' || ? || '%')
       AND (? = '' OR p.orientation = ?)
       AND (? = '' OR p.tags LIKE '%' || ? || '%')
       AND (? = '' OR p.shot_for_painting = 1)
     ORDER BY p.shot_for_painting DESC, p.id DESC
     LIMIT 200
  `).all(q || '', q || '', q || '', q || '',
         orientation || '', orientation || '',
         tag || '', tag || '',
         shotForPainting ? '1' : '');

  res.json(rows.map(photo => publicPhoto(photo)));
});

// GET /api/photos/mine - the photographer's own console, drafts included.
router.get('/mine', requireAuth, requireRole('photographer'), (req, res) => {
  const rows = db.prepare('SELECT * FROM photos WHERE photographer_id = ? ORDER BY id DESC').all(req.currentUser.id);
  res.json(rows.map(photo => publicPhoto(photo, { includePrivate: true })));
});

// GET /api/photos/:id
router.get('/:id', optionalAuth, (req, res) => {
  const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(req.params.id);
  if (!photo) return res.status(404).json({ error: 'Photo not found' });

  const owner = req.currentUser?.id === photo.photographer_id;
  if (photo.status !== 'published' && !owner) return res.status(404).json({ error: 'Photo not found' });
  res.json(publicPhoto(photo, { includePrivate: owner }));
});

// ── Upload and curation ──────────────────────────────────────────────────────

// POST /api/photos - licensed file required, display copy derived or supplied.
router.post('/', requireAuth, requireRole('photographer'),
  upload.fields([{ name: 'file', maxCount: 1 }, { name: 'display', maxCount: 1 }]),
  async (req, res) => {
    const licensed = req.files?.file?.[0];
    if (!licensed) return res.status(400).json({ error: 'Attach the full-resolution file as "file"' });

    try {
      images.assertAcceptable(licensed.originalname, licensed.buffer);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const { width, height } = images.probeDimensions(licensed.buffer);
    const licensedPath = files.save('photos', files.uniqueName(licensed.originalname, `${req.currentUser.id}/licensed-`), licensed.buffer);

    let displayPath = null, thumbPath = null;
    const supplied = req.files?.display?.[0];
    if (supplied) {
      displayPath = files.save('photos', files.uniqueName(supplied.originalname, `${req.currentUser.id}/display-`), supplied.buffer);
      thumbPath = displayPath;
    } else {
      const derived = await images.deriveRenditions(licensed.buffer).catch(() => ({ derived: false }));
      if (derived.derived) {
        displayPath = files.save('photos', files.uniqueName('.jpg', `${req.currentUser.id}/display-`), derived.display);
        thumbPath   = files.save('photos', files.uniqueName('.jpg', `${req.currentUser.id}/thumb-`),   derived.thumb);
      }
    }

    const photoId = db.tx(() => {
      const result = db.prepare(`
        INSERT INTO photos (photographer_id, title, description, tags, orientation, width, height,
                            licensed_file, display_file, thumb_file, licensed_sha256, shot_for_painting, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
      `).run(req.currentUser.id,
             (req.body.title || licensed.originalname || 'Untitled').slice(0, 200),
             req.body.description || null,
             JSON.stringify(String(req.body.tags || '').split(',').map(t => t.trim()).filter(Boolean)),
             images.orientationOf(width, height), width, height,
             licensedPath, displayPath, thumbPath, files.sha256File(licensedPath),
             req.body.shotForPainting === 'true' ? 1 : 0);

      const id = result.lastInsertRowid;
      // Commissions on by default - it is the only leg that transacts, and a
      // photographer who uploads clearly wants at least that. Everything else
      // stays off until they say otherwise.
      for (const sku of SKUS) {
        db.prepare('INSERT INTO photo_skus (photo_id, sku, enabled, floor_price_cents) VALUES (?, ?, ?, 0)')
          .run(id, sku, sku === 'commission' ? 1 : 0);
      }
      return id;
    });

    const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(photoId);
    res.status(201).json({
      photo: publicPhoto(photo, { includePrivate: true }),
      notice: displayPath ? null
        : 'No image pipeline is installed, so no web copy was generated. Upload a display copy ' +
          'before publishing - the library never shows the licensed file.',
    });
  });

// POST /api/photos/:id/display - supply the web copy by hand
router.post('/:id/display', requireAuth, requireRole('photographer'), upload.single('display'), (req, res) => {
  const photo = ownedPhoto(req, res); if (!photo) return;
  if (!req.file) return res.status(400).json({ error: 'Attach the display copy as "display"' });

  const displayPath = files.save('photos', files.uniqueName(req.file.originalname, `${req.currentUser.id}/display-`), req.file.buffer);
  db.prepare('UPDATE photos SET display_file = ?, thumb_file = COALESCE(thumb_file, ?), updated_at = datetime(\'now\') WHERE id = ?')
    .run(displayPath, displayPath, photo.id);

  res.json(publicPhoto(db.prepare('SELECT * FROM photos WHERE id = ?').get(photo.id), { includePrivate: true }));
});

// PATCH /api/photos/:id
router.patch('/:id', requireAuth, requireRole('photographer'), (req, res) => {
  const photo = ownedPhoto(req, res); if (!photo) return;
  const { title, description, tags, status, shotForPainting } = req.body || {};

  if (status && !['draft', 'published', 'withdrawn'].includes(status)) {
    return res.status(400).json({ error: 'Status must be draft, published or withdrawn' });
  }
  if (status === 'published' && !photo.display_file) {
    return res.status(400).json({ error: 'Add a display copy before publishing - the library never shows the licensed file' });
  }

  db.prepare(`
    UPDATE photos SET title = COALESCE(?, title), description = COALESCE(?, description),
                      tags = COALESCE(?, tags), status = COALESCE(?, status),
                      shot_for_painting = COALESCE(?, shot_for_painting), updated_at = datetime('now')
     WHERE id = ?
  `).run(title || null, description ?? null,
         tags ? JSON.stringify(Array.isArray(tags) ? tags : String(tags).split(',').map(t => t.trim()).filter(Boolean)) : null,
         status || null,
         shotForPainting === undefined ? null : (shotForPainting ? 1 : 0),
         photo.id);

  res.json(publicPhoto(db.prepare('SELECT * FROM photos WHERE id = ?').get(photo.id), { includePrivate: true }));
});

/**
 * PUT /api/photos/:id/skus - per-image toggles and floor prices.
 *
 * Any tier can be switched off for an image the photographer is precious about,
 * and the floor is theirs to set. Permanent exclusivity caps a strong image's
 * upside at whatever one small painter can pay today, so it is never on by
 * default and the response says so.
 */
router.put('/:id/skus', requireAuth, requireRole('photographer'), (req, res) => {
  const photo = ownedPhoto(req, res); if (!photo) return;
  const updates = req.body || {};

  const unknown = Object.keys(updates).filter(sku => !SKUS.includes(sku));
  if (unknown.length) return res.status(400).json({ error: `Unknown SKU: ${unknown.join(', ')}` });

  db.tx(() => {
    for (const [sku, value] of Object.entries(updates)) {
      const floor = Math.max(0, Math.round(Number(value.floorPriceCents ?? 0)) || 0);
      db.prepare(`
        INSERT INTO photo_skus (photo_id, sku, enabled, floor_price_cents) VALUES (?, ?, ?, ?)
        ON CONFLICT(photo_id, sku) DO UPDATE SET enabled = excluded.enabled, floor_price_cents = excluded.floor_price_cents
      `).run(photo.id, sku, value.enabled ? 1 : 0, floor);
    }
  });

  res.json({
    skus: skusFor(photo.id),
    notice: Object.keys(updates).some(s => !TRANSACTABLE.has(s))
      ? 'Only the commission SKU is transactable today. The rest are recorded as your stated terms and go live with reference licensing.'
      : null,
  });
});

// ── File delivery ────────────────────────────────────────────────────────────

router.get('/:id/display', optionalAuth, (req, res) => serveRendition(req, res, 'display_file'));
router.get('/:id/thumb',   optionalAuth, (req, res) => serveRendition(req, res, 'thumb_file'));

function serveRendition(req, res, column) {
  const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(req.params.id);
  if (!photo || !photo[column] || !files.exists(photo[column])) return res.status(404).end();

  // A draft is not public. Its owner still needs to see it in their studio, and
  // anyone party to a commission on it needs it on the commission page even if
  // the photographer has since withdrawn the image.
  if (photo.status !== 'published' && !canSeeUnpublished(photo, req.currentUser)) return res.status(404).end();
  res.type(contentTypeFor(photo[column]));
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.send(files.read(photo[column]));
}

/**
 * GET /api/photos/:id/licensed - the full-resolution file.
 *
 * Gated on an executed licence naming this user as the licensee, and stamped
 * per download with an identifier tied to that licence, so a file found later
 * outside its terms can be traced to the account that took it. No visible mark:
 * a visible watermark destroys the value structure a painter works from.
 */
router.get('/:id/licensed', requireAuth, (req, res) => {
  const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(req.params.id);
  if (!photo) return res.status(404).json({ error: 'Photo not found' });

  const license = db.prepare(`
    SELECT * FROM licenses
     WHERE photo_id = ? AND licensee_id = ? AND status = 'executed'
     ORDER BY id DESC LIMIT 1
  `).get(photo.id, req.currentUser.id);

  if (!licenses.canDownload(license, req.currentUser.id)) {
    return res.status(403).json({
      error: 'You need an executed licence for this image. If a licence is waiting, sign it first.',
    });
  }
  if (!photo.licensed_file || !files.exists(photo.licensed_file)) {
    return res.status(410).json({ error: 'The licensed file is no longer on file. Contact the photographer.' });
  }

  const original = files.read(photo.licensed_file);
  const watermarkId = watermark.newWatermarkId();
  const marked = watermark.embed(original, { watermarkId, licenseId: license.id });

  db.prepare(`
    INSERT INTO downloads (license_id, user_id, watermark_id, ip, user_agent, bytes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(license.id, req.currentUser.id, watermarkId,
         req.ip || null, req.headers['user-agent'] || null, marked.buffer.length);

  res.type(contentTypeFor(photo.licensed_file));
  res.setHeader('Content-Disposition',
    `attachment; filename="${licenses.licenseNumber(license.id)}-${path.basename(photo.licensed_file)}"`);
  res.setHeader('X-Daub-Trace', marked.embedded ? watermarkId : `${watermarkId}; ledger-only`);
  res.send(marked.buffer);
});

function canSeeUnpublished(photo, user) {
  if (!user) return false;
  if (photo.photographer_id === user.id) return true;
  return Boolean(db.prepare(`
    SELECT 1 FROM commissions
     WHERE photo_id = ? AND (buyer_id = ? OR painter_id = ? OR photographer_id = ?)
     LIMIT 1
  `).get(photo.id, user.id, user.id, user.id));
}

function ownedPhoto(req, res) {
  const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(req.params.id);
  if (!photo) { res.status(404).json({ error: 'Photo not found' }); return null; }
  if (photo.photographer_id !== req.currentUser.id) { res.status(403).json({ error: 'That is not your image' }); return null; }
  return photo;
}

module.exports = router;
module.exports.publicPhoto = publicPhoto;
