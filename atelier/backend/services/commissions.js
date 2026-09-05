/**
 * Leg A - the commission. Everything that moves a commission forward lives here.
 *
 * The shape of the deal: a buyer picks an image and a painter and pays up front.
 * The sale is guaranteed before the painter loads a brush, so there is no spec
 * risk; the photographer earns a royalty on an image they had already taken; the
 * platform holds the money until the buyer confirms delivery and then splits it.
 * Nobody invoices anybody.
 */
const db        = require('../db/database');
const money     = require('./money');
const config    = require('./config');
const payments  = require('./payments');
const licenses  = require('./licenses');
const registry  = require('./registry');
const state     = require('./commissionState');

const DEFAULT_MILESTONES = [
  ['underpainting', 'Underpainting blocked in'],
  ['progress',      'Work in progress'],
  ['finished',      'Painting finished'],
  ['shipped',       'Shipped to buyer'],
];

// ── Reads ────────────────────────────────────────────────────────────────────

function get(id) {
  return db.prepare('SELECT * FROM commissions WHERE id = ?').get(id);
}

/** The role this user holds on this specific commission. */
function roleOn(commission, user) {
  if (!commission || !user) return null;
  if (commission.buyer_id === user.id)        return 'buyer';
  if (commission.painter_id === user.id)      return 'painter';
  if (commission.photographer_id === user.id) return 'photographer';
  if (String(user.roles || '').split(',').includes('admin')) return 'admin';
  return null;
}

function detail(id, user) {
  const commission = get(id);
  if (!commission) return null;
  const role = roleOn(commission, user);
  if (!role) return null;

  const photo   = db.prepare('SELECT id, title, display_file, thumb_file, orientation FROM photos WHERE id = ?').get(commission.photo_id);
  const painter = db.prepare('SELECT id, name FROM users WHERE id = ?').get(commission.painter_id);
  const photographer = db.prepare('SELECT id, name FROM users WHERE id = ?').get(commission.photographer_id);
  const buyer   = db.prepare('SELECT id, name FROM users WHERE id = ?').get(commission.buyer_id);
  const license = commission.license_id ? licenses.status(commission.license_id) : null;
  const milestones = db.prepare('SELECT * FROM milestones WHERE commission_id = ? ORDER BY position').all(id);
  const events  = db.prepare('SELECT * FROM commission_events WHERE commission_id = ? ORDER BY id').all(id);
  const payouts = role === 'buyer'
    ? db.prepare(`SELECT party, amount_cents, state FROM payouts WHERE commission_id = ?`).all(id)
    : db.prepare(`SELECT party, amount_cents, state, transfer_ref, paid_at FROM payouts WHERE commission_id = ?`).all(id);
  const artwork = db.prepare('SELECT * FROM artworks WHERE commission_id = ?').get(id);
  const entry   = artwork ? db.prepare('SELECT public_id FROM registry_entries WHERE artwork_id = ? AND kind = ?').get(artwork.id, 'creation') : null;

  return {
    ...commission,
    role,
    stateLabel: state.STATES[commission.state],
    availableActions: state.availableActions(commission.state, role),
    photo, painter, photographer, buyer,
    license,
    milestones, events, payouts,
    artwork,
    certificateId: entry?.public_id || null,
  };
}

function listFor(user, { role } = {}) {
  const column = { buyer: 'buyer_id', painter: 'painter_id', photographer: 'photographer_id' }[role];
  const rows = column
    ? db.prepare(`SELECT * FROM commissions WHERE ${column} = ? ORDER BY id DESC`).all(user.id)
    : db.prepare(`SELECT * FROM commissions
                   WHERE buyer_id = ? OR painter_id = ? OR photographer_id = ?
                   ORDER BY id DESC`).all(user.id, user.id, user.id);

  return rows.map(commission => {
    const photo   = db.prepare('SELECT id, title, thumb_file FROM photos WHERE id = ?').get(commission.photo_id);
    const painter = db.prepare('SELECT id, name FROM users WHERE id = ?').get(commission.painter_id);
    const seenAs  = roleOn(commission, user);
    return {
      ...commission,
      photo, painter,
      role: seenAs,
      stateLabel: state.STATES[commission.state],
      // A painter should see their own take, not the buyer's price, at a glance.
      yourCents: seenAs === 'painter'      ? commission.painter_cents
               : seenAs === 'photographer' ? commission.photographer_cents
               : commission.price_cents,
    };
  });
}

// ── Quoting ──────────────────────────────────────────────────────────────────

/**
 * Price a prospective commission without creating anything. Rejects loudly and
 * specifically: a buyer who is told "unavailable" learns nothing, and a buyer
 * told the floor price can just pay it.
 */
function quote({ photoId, painterId, priceCents }) {
  const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(photoId);
  if (!photo) throw new Error('Photo not found');
  if (photo.status !== 'published') throw new Error('This image is not currently available');

  const sku = db.prepare("SELECT * FROM photo_skus WHERE photo_id = ? AND sku = 'commission'").get(photoId);
  if (!sku || !sku.enabled) throw new Error('The photographer has not made this image available for commissions');

  const painter = db.prepare('SELECT * FROM users WHERE id = ?').get(painterId);
  const profile = db.prepare('SELECT * FROM painter_profiles WHERE user_id = ?').get(painterId);
  if (!painter || !profile) throw new Error('Painter not found');
  if (!profile.accepting) throw new Error(`${painter.name} is not taking commissions right now`);

  const photographerBps = config.photographerRoyaltyBps;
  const platformBps     = config.platformFeeBps;
  const floorCents      = sku.floor_price_cents || 0;

  const minimum = Math.max(
    profile.min_price_cents || 0,
    money.minimumViablePrice({ photographerBps, platformBps, floorCents })
  );

  if (priceCents < minimum) {
    throw new Error(
      `The lowest price this commission can be booked at is ${money.fmt(minimum)}` +
      (floorCents && minimum > (profile.min_price_cents || 0)
        ? ` - the photographer set a ${money.fmt(floorCents)} floor on this image`
        : ` - ${painter.name}'s minimum`)
    );
  }
  if (profile.max_price_cents && priceCents > profile.max_price_cents) {
    throw new Error(`${painter.name} caps commissions at ${money.fmt(profile.max_price_cents)}`);
  }

  const split = money.splitCommission({ priceCents, photographerBps, platformBps, floorCents });
  return {
    ...split,
    minimumCents: minimum,
    turnaroundDays: profile.turnaround_days,
    photoId, painterId,
    photographerId: photo.photographer_id,
  };
}

// ── Creation and payment ─────────────────────────────────────────────────────

async function create({ buyer, photoId, painterId, priceCents, medium, size, brief }) {
  const priced = quote({ photoId, painterId, priceCents });
  if (priced.photographerId === buyer.id) throw new Error('You cannot commission from your own image');
  if (painterId === buyer.id)             throw new Error('You cannot commission yourself');

  const commissionId = db.tx(() => {
    const result = db.prepare(`
      INSERT INTO commissions (buyer_id, photo_id, painter_id, photographer_id, medium, size, brief,
                               price_cents, photographer_cents, platform_cents, painter_cents,
                               photographer_bps, platform_bps, state)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'quoted')
    `).run(buyer.id, photoId, painterId, priced.photographerId, medium || null, size || null, brief || null,
           priced.priceCents, priced.photographerCents, priced.platformCents, priced.painterCents,
           priced.photographerBps, priced.platformBps);

    const id = result.lastInsertRowid;
    DEFAULT_MILESTONES.forEach(([kind, label], index) => {
      db.prepare('INSERT INTO milestones (commission_id, kind, label, position) VALUES (?, ?, ?, ?)')
        .run(id, kind, label, index);
    });
    logEvent(id, null, 'quoted', buyer.id, 'buyer', 'Commission created');
    return id;
  });

  // Stripe call is outside the transaction: a network round trip must not hold
  // the database open, and a failure here should leave a quoted commission the
  // buyer can retry rather than roll back their whole basket.
  const charge = await payments.chargeIntoEscrow({
    amountCents: priced.priceCents,
    commissionId,
    buyerEmail: buyer.email,
    description: `Commission #${commissionId} - painting from photo #${photoId}`,
  });

  db.tx(() => {
    db.prepare(`UPDATE commissions SET payment_ref = ?, state = 'awaiting_payment', updated_at = datetime('now') WHERE id = ?`)
      .run(charge.paymentRef, commissionId);
    logEvent(commissionId, 'quoted', 'awaiting_payment', buyer.id, 'buyer', 'Payment started');
  });

  return { commission: get(commissionId), clientSecret: charge.clientSecret, paymentRef: charge.paymentRef };
}

/**
 * Called when Stripe says the money is in - by webhook in production, or by the
 * buyer's browser returning from checkout. Verifies with the provider rather
 * than trusting the caller, and is safe to call twice.
 */
async function confirmFunding(commissionId) {
  const commission = get(commissionId);
  if (!commission) throw new Error('Commission not found');
  if (commission.state !== 'awaiting_payment') return detailInternal(commissionId);   // already handled

  const status = await payments.paymentStatus({ paymentRef: commission.payment_ref });
  if (!status.paid) throw new Error(`Payment is ${status.status}, not settled`);

  state.assertTransition('fund', commission.state, 'system');

  return db.tx(() => {
    db.prepare(`UPDATE commissions SET state = 'funded', escrow_state = 'held', updated_at = datetime('now') WHERE id = ?`)
      .run(commissionId);
    logEvent(commissionId, 'awaiting_payment', 'funded', null, 'system', 'Payment held in escrow');

    const photo        = db.prepare('SELECT * FROM photos WHERE id = ?').get(commission.photo_id);
    const photographer = db.prepare('SELECT * FROM users WHERE id = ?').get(commission.photographer_id);
    const painter      = db.prepare('SELECT * FROM users WHERE id = ?').get(commission.painter_id);
    const buyer        = db.prepare('SELECT * FROM users WHERE id = ?').get(commission.buyer_id);

    const license = licenses.issue({ commission: get(commissionId), photo, photographer, painter, buyer });
    db.prepare('UPDATE commissions SET license_id = ? WHERE id = ?').run(license.id, commissionId);
    logEvent(commissionId, 'funded', 'funded', null, 'system', `Licence ${licenses.licenseNumber(license.id)} issued`);

    return detailInternal(commissionId);
  });
}

/**
 * Signing the licence is how a party accepts the deal. Once all three have
 * signed, the commission activates and the painter can pull the file.
 */
function signLicense(commissionId, { user, typedName, ip, userAgent }) {
  const commission = get(commissionId);
  if (!commission) throw new Error('Commission not found');
  if (!commission.license_id) throw new Error('No licence has been issued yet');

  const party = roleOn(commission, user);
  if (!['photographer', 'painter', 'buyer'].includes(party)) {
    throw new Error('Only the three named parties can sign this licence');
  }

  const result = db.tx(() => {
    const signed = licenses.sign(commission.license_id, { userId: user.id, party, typedName, ip, userAgent });
    logEvent(commissionId, commission.state, commission.state, user.id, party, `${party} signed the licence`);

    if (signed.executed && commission.state === 'funded') {
      state.assertTransition('activate', commission.state, 'system');
      db.prepare(`UPDATE commissions SET state = 'active', updated_at = datetime('now') WHERE id = ?`).run(commissionId);
      logEvent(commissionId, 'funded', 'active', null, 'system', 'Licence executed by all parties');
    }
    return signed;
  });

  return { license: result, commission: get(commissionId) };
}

// ── Delivery and settlement ──────────────────────────────────────────────────

function deliver(commissionId, { user, note, images = [] }) {
  const commission = get(commissionId);
  const role = roleOn(commission, user);
  state.assertTransition('deliver', commission.state, role);

  const now = new Date();
  const autoAcceptAt = new Date(now.getTime() + config.autoAcceptDays * 86400_000);

  return db.tx(() => {
    db.prepare(`UPDATE commissions SET state = 'delivered', delivered_at = ?, auto_accept_at = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(now.toISOString(), autoAcceptAt.toISOString(), commissionId);

    const finished = db.prepare(`SELECT id FROM milestones WHERE commission_id = ? AND kind = 'finished'`).get(commissionId);
    if (finished) {
      db.prepare(`UPDATE milestones SET state = 'complete', completed_at = ?, note = ?, image_file = ? WHERE id = ?`)
        .run(now.toISOString(), note || null, images[0] || null, finished.id);
    }

    logEvent(commissionId, 'active', 'delivered', user.id, 'painter',
             note || `Delivered; escrow releases automatically on ${autoAcceptAt.toISOString().slice(0, 10)} if the buyer does not respond`);
    return detailInternal(commissionId);
  });
}

/**
 * Buyer confirms delivery, which releases escrow. Settlement runs immediately
 * after and is where the transfers actually happen.
 */
async function accept(commissionId, { user, actorRole }) {
  const commission = get(commissionId);
  const role = actorRole || roleOn(commission, user);
  state.assertTransition('accept', commission.state, role);

  db.tx(() => {
    db.prepare(`UPDATE commissions SET state = 'accepted', accepted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
      .run(commissionId);
    logEvent(commissionId, commission.state, 'accepted', user?.id ?? null, role,
             role === 'system' ? 'Auto-accepted - buyer did not respond within the review window' : 'Buyer confirmed delivery');
  });

  return settle(commissionId);
}

/**
 * Release escrow: one transfer per payee, then the artwork record and its
 * registry entry.
 *
 * Payout rows are written before the transfers are attempted, so a transfer that
 * fails leaves a row in `failed` naming the party and the reason rather than
 * vanishing. Retrying calls the provider with the same idempotency key, so a
 * retry after a partial failure cannot double-pay the party that succeeded.
 */
async function settle(commissionId) {
  const commission = get(commissionId);
  if (commission.state === 'settled') return detailInternal(commissionId);
  state.assertTransition('settle', commission.state, 'system');

  const painter      = db.prepare('SELECT * FROM users WHERE id = ?').get(commission.painter_id);
  const photographer = db.prepare('SELECT * FROM users WHERE id = ?').get(commission.photographer_id);

  const legs = [
    { party: 'painter',      user: painter,      amountCents: commission.painter_cents },
    { party: 'photographer', user: photographer, amountCents: commission.photographer_cents },
    { party: 'platform',     user: null,         amountCents: commission.platform_cents },
  ];

  db.tx(() => {
    for (const leg of legs) {
      const existing = db.prepare('SELECT id FROM payouts WHERE commission_id = ? AND party = ?').get(commissionId, leg.party);
      if (!existing) {
        db.prepare('INSERT INTO payouts (commission_id, user_id, party, amount_cents, state) VALUES (?, ?, ?, ?, ?)')
          .run(commissionId, leg.user?.id ?? null, leg.party, leg.amountCents, leg.party === 'platform' ? 'paid' : 'pending');
      }
    }
    // The platform's share never leaves the platform balance, so it is settled
    // the moment the charge is captured.
    db.prepare(`UPDATE payouts SET state = 'paid', paid_at = COALESCE(paid_at, datetime('now')) WHERE commission_id = ? AND party = 'platform'`)
      .run(commissionId);
  });

  for (const leg of legs.filter(l => l.user)) {
    const payout = db.prepare('SELECT * FROM payouts WHERE commission_id = ? AND party = ?').get(commissionId, leg.party);
    if (payout.state === 'paid') continue;

    if (!leg.user.stripe_account_id || !leg.user.payouts_enabled) {
      db.prepare(`UPDATE payouts SET state = 'failed', failure_reason = ? WHERE id = ?`)
        .run('Payee has not completed payout onboarding', payout.id);
      continue;
    }
    try {
      const { transferRef } = await payments.transfer({
        amountCents: leg.amountCents,
        destinationAccountId: leg.user.stripe_account_id,
        commissionId, party: leg.party,
      });
      db.prepare(`UPDATE payouts SET state = 'paid', transfer_ref = ?, paid_at = datetime('now'), failure_reason = NULL WHERE id = ?`)
        .run(transferRef, payout.id);
    } catch (err) {
      db.prepare(`UPDATE payouts SET state = 'failed', failure_reason = ? WHERE id = ?`)
        .run(String(err.message).slice(0, 300), payout.id);
    }
  }

  // Settlement completes the commission whether or not every transfer landed.
  // A failed transfer is a payee onboarding problem to retry, not a reason to
  // withhold the buyer's certificate or leave escrow in limbo.
  return db.tx(() => {
    db.prepare(`UPDATE commissions SET state = 'settled', escrow_state = 'released', settled_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
      .run(commissionId);

    const shipped = db.prepare(`SELECT id FROM milestones WHERE commission_id = ? AND kind = 'shipped'`).get(commissionId);
    if (shipped) db.prepare(`UPDATE milestones SET state = 'complete', completed_at = datetime('now') WHERE id = ?`).run(shipped.id);

    const photo = db.prepare('SELECT title FROM photos WHERE id = ?').get(commission.photo_id);
    const existingArtwork = db.prepare('SELECT * FROM artworks WHERE commission_id = ?').get(commissionId);
    const artworkId = existingArtwork ? existingArtwork.id : db.prepare(`
      INSERT INTO artworks (commission_id, license_id, painter_id, photographer_id, title, medium, size, images)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(commissionId, commission.license_id, commission.painter_id, commission.photographer_id,
           photo?.title ? `After "${photo.title}"` : `Commission #${commissionId}`,
           commission.medium, commission.size,
           JSON.stringify(db.prepare(`SELECT image_file FROM milestones WHERE commission_id = ? AND image_file IS NOT NULL`)
             .all(commissionId).map(m => m.image_file))
    ).lastInsertRowid;

    const existingEntry = db.prepare(`SELECT public_id FROM registry_entries WHERE artwork_id = ? AND kind = 'creation'`).get(artworkId);
    const entry = existingEntry || registry.createEntry({ artworkId, kind: 'creation' });

    logEvent(commissionId, 'accepted', 'settled', null, 'system',
             `Escrow released; certificate ${entry.public_id} issued`);
    return detailInternal(commissionId);
  });
}

// ── Ending early ─────────────────────────────────────────────────────────────

function cancel(commissionId, { user, reason }) {
  const commission = get(commissionId);
  const role = roleOn(commission, user);
  state.assertTransition('cancel', commission.state, role);

  return db.tx(() => {
    db.prepare(`UPDATE commissions SET state = 'cancelled', cancel_reason = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(reason || null, commissionId);
    logEvent(commissionId, commission.state, 'cancelled', user.id, role, reason || 'Cancelled before payment');
    return detailInternal(commissionId);
  });
}

/** Refund the buyer in full and void the licence. Reachable after funding. */
async function refund(commissionId, { user, reason, actorRole }) {
  const commission = get(commissionId);
  const role = actorRole || roleOn(commission, user);
  state.assertTransition('refund', commission.state, role);

  const { refundRef } = await payments.refund({
    paymentRef: commission.payment_ref,
    amountCents: commission.price_cents,
    commissionId,
  });

  return db.tx(() => {
    db.prepare(`UPDATE commissions SET state = 'refunded', escrow_state = 'refunded', cancel_reason = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(reason || null, commissionId);
    if (commission.license_id) {
      db.prepare(`UPDATE licenses SET status = 'void' WHERE id = ?`).run(commission.license_id);
    }
    logEvent(commissionId, commission.state, 'refunded', user?.id ?? null, role,
             `${reason || 'Refunded'} (${refundRef})`);
    return detailInternal(commissionId);
  });
}

function dispute(commissionId, { user, reason }) {
  const commission = get(commissionId);
  const role = roleOn(commission, user);
  state.assertTransition('dispute', commission.state, role);

  return db.tx(() => {
    db.prepare(`UPDATE commissions SET state = 'disputed', auto_accept_at = NULL, updated_at = datetime('now') WHERE id = ?`)
      .run(commissionId);
    logEvent(commissionId, commission.state, 'disputed', user.id, role, reason || 'Buyer raised an issue');
    return detailInternal(commissionId);
  });
}

/**
 * Escrow cannot sit open because a buyer stopped reading their email. Anything
 * delivered and unanswered past its window is accepted on the buyer's behalf,
 * which is exactly what the delivery notice told them would happen. A disputed
 * commission has its auto_accept_at cleared and is never swept.
 */
async function sweepAutoAccept() {
  const due = db.prepare(`
    SELECT id FROM commissions
     WHERE state = 'delivered' AND auto_accept_at IS NOT NULL AND auto_accept_at <= ?
  `).all(new Date().toISOString());

  const settled = [];
  for (const { id } of due) {
    try {
      await accept(id, { user: null, actorRole: 'system' });
      settled.push(id);
    } catch (err) {
      console.error(`[escrow] Auto-accept failed for commission ${id}:`, err.message);
    }
  }
  return settled;
}

// ── Internals ────────────────────────────────────────────────────────────────

function logEvent(commissionId, fromState, toState, actorId, actorRole, note) {
  db.prepare(`
    INSERT INTO commission_events (commission_id, from_state, to_state, actor_id, actor_role, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(commissionId, fromState, toState, actorId, actorRole, note || null);
}

/** detail() without the viewer check, for internal callers that already know. */
function detailInternal(commissionId) {
  const commission = get(commissionId);
  return detail(commissionId, { id: commission.buyer_id, roles: '' });
}

module.exports = {
  get, detail, listFor, roleOn, quote, create, confirmFunding, signLicense,
  deliver, accept, settle, cancel, refund, dispute, sweepAutoAccept, logEvent,
  DEFAULT_MILESTONES,
};
