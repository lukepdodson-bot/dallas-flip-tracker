process.env.DAUB_DATA_DIR = require('node:fs').mkdtempSync('/tmp/daub-wm-');

const test   = require('node:test');
const assert = require('node:assert');
const wm     = require('../services/watermark');

function fakeJpeg() {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0', 'latin1'), Buffer.alloc(7),
    Buffer.from([0xff, 0xda, 0x00, 0x08]), Buffer.alloc(6),
    Buffer.from([0x12, 0x34, 0x56]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

function fakePng() {
  const ihdr = Buffer.concat([Buffer.from([0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.alloc(13), Buffer.alloc(4)]);
  const iend = Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from('IEND'), Buffer.alloc(4)]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, iend]);
}

test('a JPEG survives marking and reads back the same identifier', () => {
  const original = fakeJpeg();
  const id = wm.newWatermarkId();
  const marked = wm.embed(original, { watermarkId: id, licenseId: 7 });

  assert.strictEqual(marked.embedded, true);
  assert.deepStrictEqual(marked.buffer.subarray(0, 2), Buffer.from([0xff, 0xd8]), 'SOI must stay first');
  assert.deepStrictEqual(marked.buffer.subarray(-2), Buffer.from([0xff, 0xd9]), 'EOI must stay last');
  // The scan data itself must be untouched - the painter needs the pixels.
  assert.ok(marked.buffer.includes(Buffer.from([0x12, 0x34, 0x56])));

  const read = wm.extract(marked.buffer);
  assert.strictEqual(read.watermarkId, id);
  assert.strictEqual(read.licenseId, 7);
  assert.strictEqual(read.authentic, true);
});

test('a PNG round-trips through a tEXt chunk', () => {
  const id = wm.newWatermarkId();
  const marked = wm.embed(fakePng(), { watermarkId: id, licenseId: 3 });
  assert.strictEqual(marked.embedded, true);
  assert.strictEqual(wm.extract(marked.buffer).watermarkId, id);
});

test('two downloads of the same licence get different identifiers', () => {
  assert.notStrictEqual(wm.newWatermarkId(), wm.newWatermarkId());
});

test('an unmarked file reports not-found rather than guessing', () => {
  assert.strictEqual(wm.extract(fakeJpeg()).found, false);
  assert.strictEqual(wm.extract(Buffer.from('not an image')).found, false);
});

test('a forged identifier fails its signature, so a leak cannot be pinned on the wrong account', () => {
  const marked = wm.embed(fakeJpeg(), { watermarkId: 'aaaaaaaaaaaaaaaaaaaaaaaa', licenseId: 1 });
  const tampered = Buffer.from(marked.buffer);
  tampered.write('bbbbbbbbbbbbbbbbbbbbbbbb', tampered.indexOf('aaaaaaaaaaaaaaaaaaaaaaaa'));

  const read = wm.extract(tampered);
  assert.strictEqual(read.found, true);
  assert.strictEqual(read.authentic, false);
});

test('a mark still verifies when its keys come back in a different order', () => {
  // The payload is JSON in a file. Nothing guarantees a reader hands the keys
  // back in the order they were written, and key order must not decide whether
  // an account gets blamed for a leak.
  const marked = wm.embed(fakeJpeg(), { watermarkId: 'c'.repeat(24), licenseId: 11 });
  const payload = JSON.parse(wm.extract(marked.buffer) && (() => {
    // Pull the raw payload back out and rebuild it with the keys reversed.
    const text = marked.buffer.toString('latin1');
    return text.slice(text.indexOf('{"v"'), text.indexOf('}', text.indexOf('{"v"')) + 1);
  })());

  const reordered = Object.fromEntries(Object.entries(payload).reverse());
  assert.notDeepStrictEqual(Object.keys(reordered), Object.keys(payload));
  assert.strictEqual(wm.verifyPayload(reordered), true);
});

test('an unsupported container is delivered unmarked rather than corrupted', () => {
  const tiff = Buffer.concat([Buffer.from('II*\0', 'latin1'), Buffer.alloc(64)]);
  const marked = wm.embed(tiff, { watermarkId: wm.newWatermarkId(), licenseId: 1 });
  assert.strictEqual(marked.embedded, false);
  assert.deepStrictEqual(marked.buffer, tiff);
});
