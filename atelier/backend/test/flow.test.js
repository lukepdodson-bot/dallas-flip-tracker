/**
 * The commission leg, end to end over HTTP: upload, curate, quote, pay, sign,
 * download, deliver, accept, settle, verify, report.
 *
 * Runs against the real Express app with the ledger simulator standing in for
 * Stripe, so every state transition, split and document in the happy path is
 * exercised - plus the refusals that matter (unlicensed download, underpriced
 * quote, publishing without a display copy).
 */
const fs = require('node:fs');
process.env.ATELIER_DATA_DIR    = fs.mkdtempSync('/tmp/atelier-flow-data-');
process.env.ATELIER_STORAGE_DIR = fs.mkdtempSync('/tmp/atelier-flow-store-');
process.env.JWT_SECRET = 'test-secret';
process.env.PHOTOGRAPHER_ROYALTY_BPS = '1000';
process.env.PLATFORM_FEE_BPS = '1500';
delete process.env.STRIPE_SECRET_KEY;

const test   = require('node:test');
const assert = require('node:assert');

const app       = require('../server');
const db        = require('../db/database');
const { seedTemplates } = require('../seed');
const { makePng }       = require('../seed');
const watermark = require('../services/watermark');

let base;
let server;

const tokens = {};
const ids = {};

test.before(async () => {
  await db.initDB();
  seedTemplates();
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server?.close());

async function call(method, path, { as, body, form } = {}) {
  const headers = {};
  if (as) headers.Authorization = `Bearer ${tokens[as]}`;
  if (body) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${base}${path}`, {
    method, headers,
    body: form ? form : body ? JSON.stringify(body) : undefined,
  });

  const type = response.headers.get('content-type') || '';
  const payload = type.includes('json') ? await response.json()
                : type.includes('pdf') || type.includes('image') ? Buffer.from(await response.arrayBuffer())
                : await response.text();
  return { status: response.status, body: payload, headers: response.headers };
}

// ── Onboarding ───────────────────────────────────────────────────────────────

test('photographer, painter and buyer register', async () => {
  for (const [key, payload] of Object.entries({
    ada:    { email: 'ada@test.com',    name: 'Ada Okonkwo',   roles: ['photographer'], legalName: 'Adaeze Okonkwo' },
    marcus: { email: 'marcus@test.com', name: 'Marcus Reyes',  roles: ['painter'],      legalName: 'Marcus A. Reyes' },
    sam:    { email: 'sam@test.com',    name: 'Sam Whitfield', roles: ['buyer'] },
  })) {
    const r = await call('POST', '/api/auth/register', { body: { password: 'CorrectHorse9', ...payload } });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    tokens[key] = r.body.token;
    ids[key] = r.body.user.id;
  }
});

test('a painter and a photographer connect payout accounts; the buyer does not need one', async () => {
  for (const who of ['ada', 'marcus']) {
    const r = await call('POST', '/api/auth/payout-account', { as: who });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.simulated, true);
  }
  const buyer = await call('POST', '/api/auth/payout-account', { as: 'sam' });
  assert.strictEqual(buyer.status, 400);
});

test('the painter publishes a profile with a price range and turnaround', async () => {
  const r = await call('PUT', '/api/painters/me', {
    as: 'marcus',
    body: { bio: 'Oil on linen.', mediums: ['oil'], minPriceCents: 80000, maxPriceCents: 600000, turnaroundDays: 45, accepting: true },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.minPriceCents, 80000);

  const directory = await call('GET', '/api/painters');
  assert.strictEqual(directory.body.length, 1);
});

// ── The library ──────────────────────────────────────────────────────────────

test('a RAW upload is refused with an explanation', async () => {
  const form = new FormData();
  form.append('file', new Blob([Buffer.from('fake raw')]), 'shot.CR2');
  const r = await call('POST', '/api/photos', { as: 'ada', form });
  assert.strictEqual(r.status, 400);
  assert.match(r.body.error, /RAW files/);
});

test('the photographer uploads a licensed file plus a display copy', async () => {
  const form = new FormData();
  form.append('file',    new Blob([makePng(1400, 950, [214, 198, 160], [58, 74, 68])]), 'long-light.png');
  form.append('display', new Blob([makePng(900, 610,  [214, 198, 160], [58, 74, 68])]), 'long-light-web.png');
  form.append('title', 'Long light, Caddo flats');
  form.append('tags', 'landscape,water,golden hour');
  form.append('shotForPainting', 'true');

  const r = await call('POST', '/api/photos', { as: 'ada', form });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  ids.photo = r.body.photo.id;
  assert.strictEqual(r.body.photo.orientation, 'landscape');
  assert.strictEqual(r.body.photo.width, 1400);

  // Commissions on by default, every other tier off until the photographer says so.
  const skus = Object.fromEntries(r.body.photo.skus.map(s => [s.sku, s.enabled]));
  assert.strictEqual(skus.commission, true);
  assert.strictEqual(skus.exclusive_permanent, false);
});

test('a photo without a display copy cannot be published', async () => {
  const form = new FormData();
  form.append('file', new Blob([makePng(200, 200, [10, 10, 10], [200, 200, 200])]), 'no-web-copy.png');
  const upload = await call('POST', '/api/photos', { as: 'ada', form });
  assert.strictEqual(upload.status, 201);
  assert.match(upload.body.notice, /Upload a display copy/);

  const publish = await call('PATCH', `/api/photos/${upload.body.photo.id}`, { as: 'ada', body: { status: 'published' } });
  assert.strictEqual(publish.status, 400);
  assert.match(publish.body.error, /display copy/);
});

test('an unpublished image is not browsable, and neither is its display copy', async () => {
  const form = new FormData();
  form.append('file',    new Blob([makePng(300, 300, [40, 40, 40], [200, 200, 200])]), 'private.png');
  form.append('display', new Blob([makePng(200, 200, [40, 40, 40], [200, 200, 200])]), 'private-web.png');
  form.append('title', 'Not for the library');

  const upload = await call('POST', '/api/photos', { as: 'ada', form });
  const draftId = upload.body.photo.id;

  assert.strictEqual((await call('GET', `/api/photos/${draftId}`)).status, 404, 'a draft is not readable');
  assert.strictEqual((await call('GET', `/api/photos/${draftId}/display`)).status, 404,
    'and neither is the file behind it, or the draft leaks to anyone who guesses an id');

  // Its owner still needs to see it in their own studio.
  assert.strictEqual((await call('GET', `/api/photos/${draftId}/display`, { as: 'ada' })).status, 200);
});

test('the photographer sets a floor price and publishes', async () => {
  const skus = await call('PUT', `/api/photos/${ids.photo}/skus`, {
    as: 'ada', body: { commission: { enabled: true, floorPriceCents: 15000 } },
  });
  assert.strictEqual(skus.status, 200);

  const publish = await call('PATCH', `/api/photos/${ids.photo}`, { as: 'ada', body: { status: 'published' } });
  assert.strictEqual(publish.status, 200);

  const library = await call('GET', '/api/photos');
  assert.strictEqual(library.body.length, 1, 'only the published photo is browsable');
  assert.strictEqual(library.body[0].id, ids.photo);
});

test('browsing serves the display copy, never the licensed file', async () => {
  const display = await call('GET', `/api/photos/${ids.photo}/display`);
  assert.strictEqual(display.status, 200);

  const licensedRow = db.prepare('SELECT licensed_file, display_file FROM photos WHERE id = ?').get(ids.photo);
  const licensedSize = fs.statSync(`${process.env.ATELIER_STORAGE_DIR}/${licensedRow.licensed_file}`).size;
  assert.ok(display.body.length < licensedSize, 'the display copy must not be the full-resolution file');
});

// ── Quoting ──────────────────────────────────────────────────────────────────

test('an underpriced quote is refused and names the real minimum', async () => {
  const r = await call('POST', '/api/commissions/quote', {
    as: 'sam', body: { photoId: ids.photo, painterId: ids.marcus, priceCents: 50000 },
  });
  assert.strictEqual(r.status, 400);
  assert.match(r.body.error, /lowest price/);
});

test('a valid quote breaks down the split and reconciles', async () => {
  const r = await call('POST', '/api/commissions/quote', {
    as: 'sam', body: { photoId: ids.photo, painterId: ids.marcus, priceCents: 120000 },
  });
  assert.strictEqual(r.status, 200);
  const { platformCents, photographerCents, painterCents, floorApplied } = r.body;
  // 10% of $1,200 is $120, which is under the photographer's $150 floor, so the
  // floor wins and the painter absorbs the difference.
  assert.strictEqual(photographerCents, 15000);
  assert.strictEqual(floorApplied, true);
  assert.strictEqual(platformCents, 18000);
  assert.strictEqual(painterCents, 87000);
  assert.strictEqual(platformCents + photographerCents + painterCents, 120000);
});

// ── The commission ───────────────────────────────────────────────────────────

test('the buyer commissions, and the sale is guaranteed before any work starts', async () => {
  const r = await call('POST', '/api/commissions', {
    as: 'sam',
    body: { photoId: ids.photo, painterId: ids.marcus, priceCents: 120000, medium: 'oil on linen', size: '24x30in', brief: 'Warm, loose.' },
  });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  ids.commission = r.body.commission.id;
  assert.strictEqual(r.body.commission.state, 'awaiting_payment');
  assert.ok(r.body.clientSecret);
});

test('confirming payment holds the money in escrow and issues the licence', async () => {
  const r = await call('POST', `/api/commissions/${ids.commission}/confirm-payment`, { as: 'sam' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.state, 'funded');
  assert.strictEqual(r.body.escrow_state, 'held');
  assert.strictEqual(r.body.license.status, 'pending');
  assert.deepStrictEqual(r.body.license.outstanding.sort(), ['buyer', 'painter', 'photographer']);
  ids.license = r.body.license.id;
});

test('the painter cannot download the file before the licence is executed', async () => {
  const r = await call('GET', `/api/photos/${ids.photo}/licensed`, { as: 'marcus' });
  assert.strictEqual(r.status, 403);
  assert.match(r.body.error, /executed licence/);
});

test('a stranger cannot sign the licence', async () => {
  const outsider = await call('POST', '/api/auth/register', {
    body: { email: 'nobody@test.com', name: 'Nobody', password: 'CorrectHorse9', roles: ['buyer'] },
  });
  tokens.nobody = outsider.body.token;

  const r = await call('POST', `/api/commissions/${ids.commission}/sign`, { as: 'nobody', body: { typedName: 'Nobody' } });
  assert.strictEqual(r.status, 404, 'a non-party gets the same answer as for a commission that does not exist');
});

test('all three parties sign, and only then does the commission activate', async () => {
  const first = await call('POST', `/api/commissions/${ids.commission}/sign`, { as: 'ada', body: { typedName: 'Adaeze Okonkwo' } });
  assert.strictEqual(first.body.license.executed, false);
  assert.strictEqual(first.body.commission.state, 'funded');

  await call('POST', `/api/commissions/${ids.commission}/sign`, { as: 'marcus', body: { typedName: 'Marcus A. Reyes' } });

  const last = await call('POST', `/api/commissions/${ids.commission}/sign`, { as: 'sam', body: { typedName: 'Samuel Whitfield' } });
  assert.strictEqual(last.body.license.executed, true);
  assert.strictEqual(last.body.commission.state, 'active');
});

test('the licence PDF is a real PDF naming all three parties', async () => {
  const r = await call('GET', `/api/commissions/${ids.commission}/license.pdf`, { as: 'sam' });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.subarray(0, 8), Buffer.from('%PDF-1.4'));

  const text = r.body.toString('latin1');
  for (const name of ['Adaeze Okonkwo', 'Marcus A. Reyes', 'Samuel Whitfield']) {
    assert.ok(text.includes(name), `licence PDF should name ${name}`);
  }
});

test('the painter downloads the licensed file, uniquely marked each time', async () => {
  const first  = await call('GET', `/api/photos/${ids.photo}/licensed`, { as: 'marcus' });
  assert.strictEqual(first.status, 200);

  const mark = watermark.extract(first.body);
  assert.strictEqual(mark.found, true);
  assert.strictEqual(mark.authentic, true);
  assert.strictEqual(mark.licenseId, ids.license);
  ids.leakedFile = first.body;

  const second = await call('GET', `/api/photos/${ids.photo}/licensed`, { as: 'marcus' });
  assert.notStrictEqual(watermark.extract(second.body).watermarkId, mark.watermarkId,
    'each download gets its own identifier');

  const downloads = db.prepare('SELECT COUNT(*) AS c FROM downloads WHERE license_id = ?').get(ids.license);
  assert.strictEqual(downloads.c, 2);
});

test('the photographer can trace a leaked file back to the account that took it', async () => {
  const form = new FormData();
  form.append('file', new Blob([ids.leakedFile]), 'found-on-a-forum.png');

  const r = await call('POST', '/api/registry/trace', { as: 'ada', form });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.found, true);
  assert.strictEqual(r.body.authentic, true);
  assert.strictEqual(r.body.licensee.email, 'marcus@test.com');
  assert.ok(r.body.download.at);
});

test('someone else\'s photographer account cannot run that trace', async () => {
  const form = new FormData();
  form.append('file', new Blob([ids.leakedFile]), 'found.png');
  const r = await call('POST', '/api/registry/trace', { as: 'marcus', form });
  assert.strictEqual(r.status, 403);
});

// ── Delivery and settlement ──────────────────────────────────────────────────

test('the buyer cannot accept before the painter delivers', async () => {
  const r = await call('POST', `/api/commissions/${ids.commission}/accept`, { as: 'sam' });
  assert.strictEqual(r.status, 400);
  assert.match(r.body.error, /Cannot accept/);
});

test('the painter delivers, and the buyer is given a deadline that releases escrow', async () => {
  const r = await call('POST', `/api/commissions/${ids.commission}/deliver`, {
    as: 'marcus', body: { note: 'Finished and varnished; shipping Tuesday.' },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.state, 'delivered');
  assert.ok(r.body.auto_accept_at, 'escrow must not be able to sit open indefinitely');

  // The view handed back after an action has to be the caller's own, or the UI
  // renders someone else's buttons.
  assert.strictEqual(r.body.role, 'painter');
  assert.ok(!r.body.availableActions.includes('accept'), 'a painter cannot accept for the buyer');

  const buyerView = await call('GET', `/api/commissions/${ids.commission}`, { as: 'sam' });
  assert.strictEqual(buyerView.body.role, 'buyer');
  assert.ok(buyerView.body.availableActions.includes('accept'));
});

test('accepting releases escrow, splits the money and issues the certificate', async () => {
  const r = await call('POST', `/api/commissions/${ids.commission}/accept`, { as: 'sam' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.state, 'settled');
  assert.strictEqual(r.body.escrow_state, 'released');
  assert.ok(r.body.certificateId);
  ids.certificate = r.body.certificateId;

  const paid = Object.fromEntries(r.body.payouts.map(p => [p.party, p]));
  assert.strictEqual(paid.painter.amount_cents, 87000);
  assert.strictEqual(paid.photographer.amount_cents, 15000);
  assert.strictEqual(paid.platform.amount_cents, 18000);
  for (const party of ['painter', 'photographer', 'platform']) {
    assert.strictEqual(paid[party].state, 'paid', `${party} payout should have landed`);
  }
  assert.strictEqual(
    paid.painter.amount_cents + paid.photographer.amount_cents + paid.platform.amount_cents, 120000);
});

test('settling twice does not pay anyone twice', async () => {
  const again = await call('POST', `/api/commissions/${ids.commission}/accept`, { as: 'sam' });
  assert.strictEqual(again.status, 400);

  const rows = db.prepare('SELECT COUNT(*) AS c FROM payouts WHERE commission_id = ?').get(ids.commission);
  assert.strictEqual(rows.c, 3);
});

// ── The certificate ──────────────────────────────────────────────────────────

test('anyone can verify the certificate without an account', async () => {
  const r = await call('GET', `/api/registry/${ids.certificate}`);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.valid, true);
  assert.strictEqual(r.body.content.creators.painter.name, 'Marcus A. Reyes');
  assert.strictEqual(r.body.content.creators.photographer.name, 'Adaeze Okonkwo');
  assert.strictEqual(r.body.content.license.tier, 'single_use');
  assert.ok(!('priceCents' in (r.body.content.commission || {})), 'provenance, not a price index');
});

test('the certificate PDF is public, and the signing key is published', async () => {
  const pdf = await call('GET', `/api/registry/${ids.certificate}/certificate.pdf`);
  assert.strictEqual(pdf.status, 200);
  assert.deepStrictEqual(pdf.body.subarray(0, 8), Buffer.from('%PDF-1.4'));

  const key = await call('GET', '/api/registry/key');
  assert.strictEqual(key.body.algorithm, 'Ed25519');
  assert.match(key.body.publicKeyPem, /BEGIN PUBLIC KEY/);
});

// ── Tax ──────────────────────────────────────────────────────────────────────

test('the platform can state what it paid each party this year', async () => {
  const year = new Date().getUTCFullYear();

  const painter = await call('POST', `/api/tax/documents/${year}`, { as: 'marcus' });
  assert.strictEqual(painter.status, 200);
  assert.strictEqual(painter.body.grossCents, 87000);
  assert.strictEqual(painter.body.payoutCount, 1);

  const photographer = await call('POST', `/api/tax/documents/${year}`, { as: 'ada' });
  assert.strictEqual(photographer.body.grossCents, 15000);

  // The threshold applied is whichever one belongs to that tax year, and the
  // reportable flag has to follow it rather than a number baked in here.
  assert.strictEqual(painter.body.reportable, painter.body.grossCents >= painter.body.thresholdCents);
  assert.strictEqual(photographer.body.reportable, false, '$150 is below every threshold');

  const pdf = await call('GET', `/api/tax/documents/${year}/pdf`, { as: 'marcus' });
  assert.strictEqual(pdf.status, 200);
  assert.deepStrictEqual(pdf.body.subarray(0, 8), Buffer.from('%PDF-1.4'));
});

test('one party cannot read another party\'s commission', async () => {
  const r = await call('GET', `/api/commissions/${ids.commission}`, { as: 'nobody' });
  assert.strictEqual(r.status, 404);
});
