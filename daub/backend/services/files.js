/**
 * Local file storage. One module so the whole app has a single seam to swap for
 * S3 later: nothing outside here builds a path or touches fs.
 */
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const ROOT = process.env.DAUB_STORAGE_DIR || path.join(__dirname, '..', 'storage');

const BUCKETS = ['photos', 'licenses', 'certificates', 'artworks', 'tax'];
for (const bucket of BUCKETS) fs.mkdirSync(path.join(ROOT, bucket), { recursive: true });

function resolve(relative) {
  const full = path.resolve(ROOT, relative);
  // Stored paths come from the database, but a traversal here would read
  // anything on the box, so the check is cheap insurance.
  if (!full.startsWith(path.resolve(ROOT) + path.sep)) throw new Error('Path escapes storage root');
  return full;
}

function save(bucket, filename, buffer) {
  if (!BUCKETS.includes(bucket)) throw new Error(`Unknown storage bucket "${bucket}"`);
  const relative = path.join(bucket, filename);
  const full = resolve(relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buffer);
  return relative;
}

function read(relative) {
  return fs.readFileSync(resolve(relative));
}

function exists(relative) {
  try { return fs.existsSync(resolve(relative)); } catch { return false; }
}

function remove(relative) {
  try { fs.unlinkSync(resolve(relative)); return true; } catch { return false; }
}

function sizeOf(relative) {
  try { return fs.statSync(resolve(relative)).size; } catch { return 0; }
}

function sha256File(relative) {
  return crypto.createHash('sha256').update(read(relative)).digest('hex');
}

/** Collision-proof filename that keeps the original extension. */
function uniqueName(originalName, prefix = '') {
  const ext = path.extname(originalName || '').toLowerCase().slice(0, 8) || '.bin';
  return `${prefix}${crypto.randomBytes(10).toString('hex')}${ext}`;
}

module.exports = { ROOT, save, read, exists, remove, sizeOf, sha256File, uniqueName, resolve };
