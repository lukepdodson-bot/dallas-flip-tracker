/**
 * Per-download file tracing.
 *
 * Every delivered file carries a unique identifier bound to one download by one
 * licensee, recorded in the `downloads` table, so a leaked file can be traced
 * back to the account that took it. Painters never see a visible mark - a visible
 * watermark destroys the edge detail and value structure they work from, which is
 * the whole reason they are licensing a good image in the first place.
 *
 * SCOPE OF THIS IMPLEMENTATION: the identifier is embedded in container metadata
 * (a JPEG APP11 segment, a PNG tEXt chunk). That is real and it round-trips
 * through copying, re-hosting and most CDNs - but it is stripped by a re-encode
 * or by any tool that discards metadata. It raises the cost of casual leaking; it
 * does not survive a determined one.
 *
 * Production needs a forensic watermark in the frequency domain, which means a
 * real image pipeline (Digimarc, Imatag, or a DCT implementation over a decoded
 * bitmap). embed()/extract() below are the seam for it: swap the two functions,
 * and the ledger, the delivery route and the trace endpoint are unchanged.
 */
const crypto  = require('crypto');
const signing = require('./signing');
const { canonicalise } = require('./canonical');

const JPEG_MARKER = 0xeb;                        // APP11
const SIGNATURE   = Buffer.from('ATLRTRACE\0', 'latin1');
const PNG_MAGIC   = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_KEYWORD = 'Atelier-Trace';

/** A fresh identifier for one download. Not reused across downloads of a licence. */
function newWatermarkId() {
  return crypto.randomBytes(12).toString('hex');
}

/**
 * The payload written into the file. Signed so a stripped-and-forged marker
 * cannot be used to pin a leak on an innocent licensee.
 */
function digestOf(body) {
  // Canonical form, not JSON.stringify: the verifier reconstructs this object
  // by destructuring a parsed payload, and key order must not be what decides
  // whether a mark verifies.
  return crypto.createHash('sha256').update(canonicalise(body)).digest('hex');
}

function buildPayload({ watermarkId, licenseId, issuedAt = new Date().toISOString() }) {
  const body = { v: 1, id: watermarkId, lic: licenseId, iss: issuedAt };
  return Buffer.from(JSON.stringify({ ...body, sig: signing.sign(digestOf(body)), kid: signing.keyId() }), 'utf8');
}

function verifyPayload(payload) {
  const { sig, kid, ...body } = payload;
  if (!sig) return false;
  return signing.verify(digestOf(body), sig);
}

function detectFormat(buffer) {
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpeg';
  if (buffer.length > 8 && buffer.subarray(0, 8).equals(PNG_MAGIC)) return 'png';
  if (buffer.length > 4 && (buffer.subarray(0, 4).equals(Buffer.from('II*\0', 'latin1'))
                         || buffer.subarray(0, 4).equals(Buffer.from('MM\0*', 'latin1')))) return 'tiff';
  return 'unknown';
}

// ── JPEG ─────────────────────────────────────────────────────────────────────
function embedJpeg(buffer, payload) {
  const body    = Buffer.concat([SIGNATURE, payload]);
  const segment = Buffer.alloc(4 + body.length);
  segment[0] = 0xff;
  segment[1] = JPEG_MARKER;
  segment.writeUInt16BE(body.length + 2, 2);     // length counts itself
  body.copy(segment, 4);
  // Straight after SOI, before any other marker - always legal, always found.
  return Buffer.concat([buffer.subarray(0, 2), segment, buffer.subarray(2)]);
}

function extractJpeg(buffer) {
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) { offset++; continue; }
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    if (marker === 0xda || marker === 0xd9) return null;   // start of scan - metadata is behind us
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if (marker === JPEG_MARKER) {
      const body = buffer.subarray(offset + 4, offset + 2 + length);
      if (body.subarray(0, SIGNATURE.length).equals(SIGNATURE)) {
        return body.subarray(SIGNATURE.length).toString('utf8');
      }
    }
    offset += 2 + length;
  }
  return null;
}

// ── PNG ──────────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function embedPng(buffer, payload) {
  const data  = Buffer.concat([Buffer.from(`${PNG_KEYWORD}\0`, 'latin1'), payload]);
  const type  = Buffer.from('tEXt', 'latin1');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  type.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([type, data])), 8 + data.length);
  // After IHDR, which is always the first chunk and always 25 bytes.
  const insertAt = 8 + 25;
  return Buffer.concat([buffer.subarray(0, insertAt), chunk, buffer.subarray(insertAt)]);
}

function extractPng(buffer) {
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type   = buffer.subarray(offset + 4, offset + 8).toString('latin1');
    if (type === 'IEND') return null;
    if (type === 'tEXt') {
      const data = buffer.subarray(offset + 8, offset + 8 + length);
      const nul  = data.indexOf(0);
      if (nul !== -1 && data.subarray(0, nul).toString('latin1') === PNG_KEYWORD) {
        return data.subarray(nul + 1).toString('utf8');
      }
    }
    offset += 12 + length;
  }
  return null;
}

// ── Public surface ───────────────────────────────────────────────────────────

/**
 * Stamp a delivery copy. Returns the marked buffer and whether the mark actually
 * went in - TIFF and unknown containers are delivered unmarked, tracked only by
 * the download ledger, and the caller is expected to say so.
 */
function embed(buffer, { watermarkId, licenseId, issuedAt }) {
  const payload = buildPayload({ watermarkId, licenseId, issuedAt });
  switch (detectFormat(buffer)) {
    case 'jpeg': return { buffer: embedJpeg(buffer, payload), embedded: true, format: 'jpeg' };
    case 'png':  return { buffer: embedPng(buffer, payload),  embedded: true, format: 'png' };
    default:     return { buffer, embedded: false, format: detectFormat(buffer) };
  }
}

/** Read a mark back out of a file someone found in the wild. */
function extract(buffer) {
  const format = detectFormat(buffer);
  const raw = format === 'jpeg' ? extractJpeg(buffer)
            : format === 'png'  ? extractPng(buffer)
            : null;
  if (!raw) return { found: false, format };

  let payload;
  try { payload = JSON.parse(raw); } catch { return { found: false, format, error: 'malformed payload' }; }

  return {
    found: true,
    format,
    authentic: verifyPayload(payload),
    watermarkId: payload.id,
    licenseId: payload.lic,
    issuedAt: payload.iss,
    keyId: payload.kid,
  };
}

module.exports = { newWatermarkId, embed, extract, detectFormat, buildPayload, verifyPayload };
