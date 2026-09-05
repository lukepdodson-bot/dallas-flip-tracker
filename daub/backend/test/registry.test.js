const fs = require('node:fs');
process.env.DAUB_DATA_DIR    = fs.mkdtempSync('/tmp/daub-reg-data-');
process.env.DAUB_STORAGE_DIR = fs.mkdtempSync('/tmp/daub-reg-store-');

const test   = require('node:test');
const assert = require('node:assert');

const db       = require('../db/database');
const registry = require('../services/registry');
const signing  = require('../services/signing');
const { canonicalise, hashOf } = require('../services/canonical');

test.before(async () => {
  await db.initDB();
  db.prepare(`INSERT INTO users (id, email, name, password_hash, roles) VALUES (1, 'p@x.com', 'Ada Okonkwo', 'x', 'photographer')`).run();
  db.prepare(`INSERT INTO users (id, email, name, password_hash, roles) VALUES (2, 'a@x.com', 'Marcus Reyes', 'x', 'painter')`).run();
  db.prepare(`INSERT INTO artworks (id, painter_id, photographer_id, title, medium, size)
              VALUES (1, 2, 1, 'After "Long light"', 'oil on linen', '24x30in')`).run();
});

test('canonical JSON does not depend on key order', () => {
  assert.strictEqual(
    canonicalise({ b: 1, a: { z: 2, y: [3, 'x'] } }),
    canonicalise({ a: { y: [3, 'x'], z: 2 }, b: 1 }));
});

test('canonicalise refuses undefined rather than silently dropping a field', () => {
  assert.throws(() => canonicalise(undefined), /undefined/);
  assert.throws(() => canonicalise(NaN), /non-finite/);
});

test('an entry verifies, and its certificate number is quotable', () => {
  const entry = registry.createEntry({ artworkId: 1 });
  assert.match(entry.public_id, /^DAB-\d{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{2}$/);

  const result = registry.verify(entry.public_id);
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.content.creators.painter.name, 'Marcus Reyes');
  assert.strictEqual(result.content.creators.photographer.name, 'Ada Okonkwo');
});

test('an unknown certificate number is a clean miss, not a crash', () => {
  const result = registry.verify('DAB-2026-ZZZZ-ZZ');
  assert.strictEqual(result.valid, false);
  assert.match(result.reason, /No entry/);
});

test('editing the stored record breaks verification', () => {
  const entry = registry.createEntry({ artworkId: 1 });
  const forged = JSON.parse(entry.canonical);
  forged.creators.painter.name = 'Someone Else';

  db.prepare('UPDATE registry_entries SET canonical = ? WHERE public_id = ?')
    .run(canonicalise(forged), entry.public_id);

  const result = registry.verify(entry.public_id);
  assert.strictEqual(result.valid, false);
  assert.match(result.reason, /does not match its hash/);
});

test('a re-signed forgery still fails, because the signing key is not in the database', () => {
  const entry = registry.createEntry({ artworkId: 1 });
  const forged = JSON.parse(entry.canonical);
  forged.creators.painter.name = 'Someone Else';
  const { canonical, hash } = hashOf(forged);

  // Attacker rewrites the row consistently but cannot produce the signature.
  db.prepare('UPDATE registry_entries SET canonical = ?, content_hash = ? WHERE public_id = ?')
    .run(canonical, hash, entry.public_id);

  const result = registry.verify(entry.public_id);
  assert.strictEqual(result.valid, false);
  assert.match(result.reason, /Signature does not verify/);
});

test('the published public key verifies what the platform signed', () => {
  const { hash } = hashOf({ hello: 'world' });
  assert.strictEqual(signing.verify(hash, signing.sign(hash), signing.publicKeyPem()), true);
});

test('provenance chains oldest first', () => {
  const first  = registry.createEntry({ artworkId: 1 });
  const second = registry.createEntry({ artworkId: 1, kind: 'resale', previousEntryHash: first.content_hash });

  const chain = registry.chainFor(1);
  assert.strictEqual(chain.at(-1).publicId, second.public_id);
  assert.strictEqual(chain.at(-1).previousEntryHash, first.content_hash);
});
