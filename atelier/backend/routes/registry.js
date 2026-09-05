const express   = require('express');
const multer    = require('multer');
const db        = require('../db/database');
const files     = require('../services/files');
const registry  = require('../services/registry');
const signing   = require('../services/signing');
const watermark = require('../services/watermark');
const { requireAuth } = require('./auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 120 * 1024 * 1024 } });

/**
 * GET /api/registry/key - the public key certificates are checked against.
 *
 * Public and unauthenticated on purpose: a certificate nobody outside the
 * platform can verify is just a claim.
 */
router.get('/key', (_req, res) => {
  res.json({
    algorithm: 'Ed25519',
    keyId: signing.keyId(),
    publicKeyPem: signing.publicKeyPem(),
    howToVerify: 'The signature is over the ASCII hex of the SHA-256 digest of the entry\'s canonical JSON.',
  });
});

/**
 * POST /api/registry/trace - identify the source of a leaked file.
 *
 * Restricted to the photographer whose image it is, and to admins. The result
 * names an account, so it is not a lookup to leave open.
 */
router.post('/trace', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Attach the file you found as "file"' });

  const mark = watermark.extract(req.file.buffer);
  if (!mark.found) {
    return res.json({
      found: false, format: mark.format,
      note: 'No identifier in this file. It was either never delivered by the platform, or the ' +
            'metadata was stripped - container marks do not survive a re-encode.',
    });
  }

  const download = db.prepare('SELECT * FROM downloads WHERE watermark_id = ?').get(mark.watermarkId);
  const license  = db.prepare('SELECT * FROM licenses WHERE id = ?').get(mark.licenseId);
  if (!license) return res.json({ found: true, authentic: mark.authentic, note: 'The identifier does not match any licence on file.' });

  const isAdmin = String(req.currentUser.roles || '').split(',').includes('admin');
  if (license.photographer_id !== req.currentUser.id && !isAdmin) {
    return res.status(403).json({ error: 'Only the photographer who owns this image can trace it' });
  }

  const licensee = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(license.licensee_id);
  const photo    = db.prepare('SELECT id, title FROM photos WHERE id = ?').get(license.photo_id);

  res.json({
    found: true,
    authentic: mark.authentic,
    warning: mark.authentic ? null : 'This identifier does not carry a valid platform signature. Treat it as forged.',
    photo,
    licence: { id: license.id, tier: license.tier, status: license.status, issuedAt: license.issued_at },
    licensee,
    download: download ? { at: download.created_at, ip: download.ip, userAgent: download.user_agent } : null,
  });
});

// GET /api/registry/:publicId - public verification
router.get('/:publicId', (req, res) => {
  const result = registry.verify(req.params.publicId);
  if (!result.valid && result.reason === 'No entry with that certificate number') {
    return res.status(404).json(result);
  }
  const entry = db.prepare('SELECT artwork_id FROM registry_entries WHERE public_id = ?').get(req.params.publicId);
  res.json({
    ...result,
    provenance: entry ? registry.chainFor(entry.artwork_id) : [],
    certificateUrl: `/api/registry/${req.params.publicId}/certificate.pdf`,
  });
});

// GET /api/registry/:publicId/certificate.pdf - public
router.get('/:publicId/certificate.pdf', (req, res) => {
  const entry = db.prepare('SELECT public_id FROM registry_entries WHERE public_id = ?').get(req.params.publicId);
  if (!entry) return res.status(404).json({ error: 'No entry with that certificate number' });

  const path = registry.certificatePath(entry.public_id);
  if (!files.exists(path)) return res.status(404).json({ error: 'Certificate file is missing' });

  res.type('application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${entry.public_id}.pdf"`);
  res.send(files.read(path));
});

module.exports = router;
