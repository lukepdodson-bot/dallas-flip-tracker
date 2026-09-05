/**
 * Renditions and format policy.
 *
 * Three renditions per photo: the licensed full-resolution file that only an
 * executed licence unlocks, a web display copy, and a thumbnail. The display
 * copy is what the library shows, so the full-resolution file never leaves the
 * server as a side effect of browsing.
 *
 * RAW IS REFUSED. A painter does not need unprocessed sensor data - a full
 * resolution JPEG or TIFF is more useful to them anyway, because the
 * photographer's own colour and tonal decisions are already baked into it. RAW
 * would hand over the negative, which is not what is being licensed.
 *
 * Deriving the display copy needs a real image pipeline. sharp is an optional
 * dependency: with it, renditions are generated on upload; without it, the
 * photographer uploads their own display copy and the photo stays in `draft`
 * until they do. Nothing pretends to have resized an image it could not open.
 */
const path = require('path');

const ACCEPTED = new Set(['.jpg', '.jpeg', '.tif', '.tiff', '.png']);

// Extensions and magic numbers for the RAW formats worth naming in an error.
const RAW_EXTENSIONS = new Set([
  '.cr2', '.cr3', '.crw', '.nef', '.nrw', '.arw', '.srf', '.sr2', '.dng',
  '.orf', '.raf', '.rw2', '.pef', '.raw', '.rwl', '.iiq', '.3fr', '.erf', '.mos', '.x3f',
]);

let sharpModule;
let sharpChecked = false;
function sharp() {
  if (!sharpChecked) {
    sharpChecked = true;
    try { sharpModule = require('sharp'); }
    catch { sharpModule = null; }
  }
  return sharpModule;
}

const hasPipeline = () => Boolean(sharp());

/** JPEG/PNG/TIFF dimensions without decoding the whole image. */
function probeDimensions(buffer) {
  if (buffer.length > 24 && buffer[0] === 0x89 && buffer.subarray(1, 4).toString('latin1') === 'PNG') {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), format: 'png' };
  }

  if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset++; continue; }
      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      if (marker === 0xda || marker === 0xd9) break;
      const length = buffer.readUInt16BE(offset + 2);
      // SOF0..SOF15, excluding the DHT/JPG/DAC markers that share the range.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7), format: 'jpeg' };
      }
      offset += 2 + length;
    }
    return { width: null, height: null, format: 'jpeg' };
  }

  const little = buffer.subarray(0, 4).toString('latin1') === 'II*\0';
  const big    = buffer.subarray(0, 4).toString('latin1') === 'MM\0*';
  if (little || big) return { width: null, height: null, format: 'tiff' };

  return { width: null, height: null, format: 'unknown' };
}

function orientationOf(width, height) {
  if (!width || !height) return null;
  if (Math.abs(width - height) / Math.max(width, height) < 0.05) return 'square';
  return width > height ? 'landscape' : 'portrait';
}

/**
 * Reject anything that is not a deliverable licensed file. Checks the extension
 * and the magic bytes, because an uploader renaming a .CR2 to .jpg is a mistake
 * worth catching before it reaches a painter.
 */
function assertAcceptable(originalName, buffer) {
  const ext = path.extname(originalName || '').toLowerCase();

  if (RAW_EXTENSIONS.has(ext)) {
    throw new Error(
      `RAW files (${ext}) are never delivered on this platform. Export a full-resolution JPEG or TIFF ` +
      'instead - it carries your own colour and tonal decisions, which is what a painter actually needs.'
    );
  }
  if (!ACCEPTED.has(ext)) {
    throw new Error(`Upload a JPEG, TIFF or PNG. "${ext || 'that file'}" is not accepted.`);
  }

  const { format } = probeDimensions(buffer);
  if (format === 'unknown') {
    throw new Error('That file is not a readable JPEG, TIFF or PNG, whatever it is named.');
  }
  return format;
}

/**
 * Produce display and thumbnail copies. Returns nulls when no pipeline is
 * installed, and the caller keeps the photo in draft until the photographer
 * supplies a display copy themselves.
 */
async function deriveRenditions(buffer) {
  if (!hasPipeline()) return { display: null, thumb: null, derived: false };

  const [display, thumb] = await Promise.all([
    sharp()(buffer).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, progressive: true }).toBuffer(),
    sharp()(buffer).rotate().resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 78 }).toBuffer(),
  ]);
  return { display, thumb, derived: true };
}

module.exports = {
  ACCEPTED, RAW_EXTENSIONS, assertAcceptable, deriveRenditions,
  probeDimensions, orientationOf, hasPipeline,
};
