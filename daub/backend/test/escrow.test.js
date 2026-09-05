/**
 * The paths where escrow does something other than release cleanly: refund,
 * dispute, and the sweep that stops escrow sitting open because a buyer stopped
 * reading their email.
 */
const fs = require('node:fs');
process.env.DAUB_DATA_DIR    = fs.mkdtempSync('/tmp/daub-escrow-data-');
process.env.DAUB_STORAGE_DIR = fs.mkdtempSync('/tmp/daub-escrow-store-');
process.env.AUTO_ACCEPT_DAYS    = '7';
delete process.env.STRIPE_SECRET_KEY;

const test   = require('node:test');
const assert = require('node:assert');

const db          = require('../db/database');
const commissions = require('../services/commissions');
const { seedTemplates } = require('../seed');

const users = {};

test.before(async () => {
  await db.initDB();
  seedTemplates();

  const add = (email, name, roles, payouts) => db.prepare(`
    INSERT INTO users (email, name, password_hash, roles, legal_name, stripe_account_id, payouts_enabled)
    VALUES (?, ?, 'x', ?, ?, ?, ?)
  `).run(email, name, roles, name, payouts ? `acct_${email}` : null, payouts ? 1 : 0).lastInsertRowid;

  users.photographer = { id: add('p@x.com', 'Ada',    'photographer', true),  roles: 'photographer' };
  users.painter      = { id: add('a@x.com', 'Marcus', 'painter',      true),  roles: 'painter' };
  users.buyer        = { id: add('b@x.com', 'Sam',    'buyer',        false), roles: 'buyer', email: 'b@x.com' };
  users.broke        = { id: add('c@x.com', 'Nia',    'painter',      false), roles: 'painter' };

  db.prepare('INSERT INTO painter_profiles (user_id, min_price_cents, accepting) VALUES (?, 10000, 1)').run(users.painter.id);
  db.prepare('INSERT INTO painter_profiles (user_id, min_price_cents, accepting) VALUES (?, 10000, 1)').run(users.broke.id);

  const photoId = db.prepare(`
    INSERT INTO photos (photographer_id, title, licensed_file, display_file, status)
    VALUES (?, 'Test image', 'photos/x.png', 'photos/x.png', 'published')
  `).run(users.photographer.id).lastInsertRowid;
  db.prepare("INSERT INTO photo_skus (photo_id, sku, enabled, floor_price_cents) VALUES (?, 'commission', 1, 0)").run(photoId);
  users.photoId = photoId;
});

/** Build a commission and take it as far as the named state. */
async function makeCommission({ painterId = users.painter.id, upTo = 'active', priceCents = 100000 } = {}) {
  const { commission } = await commissions.create({
    buyer: users.buyer, photoId: users.photoId, painterId, priceCents, medium: 'oil', size: '16x20in',
  });
  if (upTo === 'awaiting_payment') return commission.id;

  await commissions.confirmFunding(commission.id);
  if (upTo === 'funded') return commission.id;

  for (const [party, user] of [['photographer', users.photographer], ['painter', { id: painterId }], ['buyer', users.buyer]]) {
    commissions.signLicense(commission.id, { user: { ...user, roles: party }, typedName: `${party} name` });
  }
  if (upTo === 'active') return commission.id;

  commissions.deliver(commission.id, { user: { id: painterId }, note: 'Done' });
  return commission.id;
}

test('a refund after funding reverses escrow and voids the licence', async () => {
  const id = await makeCommission({ upTo: 'active' });
  const result = await commissions.refund(id, { user: users.buyer, reason: 'Changed my mind' });

  assert.strictEqual(result.state, 'refunded');
  assert.strictEqual(result.escrow_state, 'refunded');
  assert.strictEqual(result.license.status, 'void');

  const payouts = db.prepare('SELECT COUNT(*) AS c FROM payouts WHERE commission_id = ?').get(id);
  assert.strictEqual(payouts.c, 0, 'a refunded commission must never pay anyone out');
});

test('a voided licence stops the painter downloading', async () => {
  const id = await makeCommission({ upTo: 'active' });
  const before = db.prepare('SELECT * FROM licenses WHERE commission_id = ?').get(id);
  assert.strictEqual(require('../services/licenses').canDownload(before, users.painter.id), true);

  await commissions.refund(id, { user: users.buyer, reason: 'Painter fell ill' });

  const after = db.prepare('SELECT * FROM licenses WHERE commission_id = ?').get(id);
  assert.strictEqual(require('../services/licenses').canDownload(after, users.painter.id), false);
});

test('a disputed commission is never swept into settlement', async () => {
  const id = await makeCommission({ upTo: 'delivered' });
  commissions.dispute(id, { user: users.buyer, reason: 'Colours are off' });

  const row = commissions.get(id);
  assert.strictEqual(row.state, 'disputed');
  assert.strictEqual(row.auto_accept_at, null, 'the sweep must not have a deadline to act on');

  const swept = await commissions.sweepAutoAccept();
  assert.ok(!swept.includes(id));
  assert.strictEqual(commissions.get(id).state, 'disputed');
});

test('a dispute can be resolved in the buyer\'s favour and refunded', async () => {
  const id = await makeCommission({ upTo: 'delivered' });
  commissions.dispute(id, { user: users.buyer, reason: 'Not as briefed' });

  const result = await commissions.refund(id, { user: users.buyer, actorRole: 'admin', reason: 'Resolved for the buyer' });
  assert.strictEqual(result.state, 'refunded');
});

test('delivered work left unanswered past its window is accepted and settled', async () => {
  const id = await makeCommission({ upTo: 'delivered' });

  // Wind the deadline back rather than waiting a week.
  db.prepare('UPDATE commissions SET auto_accept_at = ? WHERE id = ?')
    .run(new Date(Date.now() - 1000).toISOString(), id);

  const swept = await commissions.sweepAutoAccept();
  assert.ok(swept.includes(id));

  const settled = commissions.get(id);
  assert.strictEqual(settled.state, 'settled');
  assert.strictEqual(settled.escrow_state, 'released');

  const events = db.prepare('SELECT note FROM commission_events WHERE commission_id = ? AND to_state = ?').all(id, 'accepted');
  assert.match(events[0].note, /Auto-accepted/);
});

test('work that is not yet delivered is never swept', async () => {
  const id = await makeCommission({ upTo: 'active' });
  const swept = await commissions.sweepAutoAccept();
  assert.ok(!swept.includes(id));
  assert.strictEqual(commissions.get(id).state, 'active');
});

test('a payee without payout onboarding fails their leg without blocking the buyer', async () => {
  const id = await makeCommission({ painterId: users.broke.id, upTo: 'delivered' });
  const result = await commissions.accept(id, { user: users.buyer });

  // The buyer's side of the deal completes: escrow released, certificate issued.
  assert.strictEqual(result.state, 'settled');
  assert.ok(result.certificateId);

  const payouts = Object.fromEntries(
    db.prepare('SELECT party, state, failure_reason FROM payouts WHERE commission_id = ?').all(id)
      .map(p => [p.party, p]));
  assert.strictEqual(payouts.painter.state, 'failed');
  assert.match(payouts.painter.failure_reason, /payout onboarding/);
  assert.strictEqual(payouts.photographer.state, 'paid');
  assert.strictEqual(payouts.platform.state, 'paid');
});

test('retrying settlement pays the failed leg without re-paying the settled ones', async () => {
  const id = await makeCommission({ painterId: users.broke.id, upTo: 'delivered' });
  await commissions.accept(id, { user: users.buyer });

  const photographerBefore = db.prepare("SELECT transfer_ref FROM payouts WHERE commission_id = ? AND party = 'photographer'").get(id);

  // The painter finishes onboarding, and settlement is re-run.
  db.prepare('UPDATE users SET payouts_enabled = 1, stripe_account_id = ? WHERE id = ?').run('acct_late', users.broke.id);
  db.prepare("UPDATE commissions SET state = 'accepted' WHERE id = ?").run(id);
  await commissions.settle(id);

  const payouts = Object.fromEntries(
    db.prepare('SELECT party, state, transfer_ref FROM payouts WHERE commission_id = ?').all(id).map(p => [p.party, p]));
  assert.strictEqual(payouts.painter.state, 'paid');
  assert.strictEqual(payouts.photographer.transfer_ref, photographerBefore.transfer_ref,
    'the already-paid leg keeps its original transfer, so nobody is paid twice');

  const rows = db.prepare('SELECT COUNT(*) AS c FROM payouts WHERE commission_id = ?').get(id);
  assert.strictEqual(rows.c, 3);
});

test('a second certificate is not minted when settlement is re-run', async () => {
  const id = await makeCommission({ upTo: 'delivered' });
  await commissions.accept(id, { user: users.buyer });

  const artwork = db.prepare('SELECT id FROM artworks WHERE commission_id = ?').get(id);
  db.prepare("UPDATE commissions SET state = 'accepted' WHERE id = ?").run(id);
  await commissions.settle(id);

  const entries = db.prepare('SELECT COUNT(*) AS c FROM registry_entries WHERE artwork_id = ?').get(artwork.id);
  assert.strictEqual(entries.c, 1);
  const artworks = db.prepare('SELECT COUNT(*) AS c FROM artworks WHERE commission_id = ?').get(id);
  assert.strictEqual(artworks.c, 1);
});
