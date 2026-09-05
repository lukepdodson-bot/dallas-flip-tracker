/**
 * Stripe Connect: escrow and multi-party payout.
 *
 * ESCROW SHAPE. This uses separate charges and transfers, not destination
 * charges with manual capture. An uncaptured PaymentIntent expires after seven
 * days, and a painting takes weeks - so the buyer's card is charged at the point
 * of commission, the funds settle onto the platform balance, and the transfers to
 * the painter and the photographer are created when the buyer confirms delivery.
 * The platform is the merchant of record for the whole leg, which is also what
 * makes 1099 reporting and sales tax the platform's job rather than the artists'.
 *
 * The painter never invoices the photographer and the photographer never chases
 * anyone: one buyer payment fans out at settlement.
 *
 * NO SMART CONTRACTS. Stripe already does multi-party payouts in dollars with tax
 * handling. A chain would add crypto onboarding friction for buyers who want a
 * painting, and buy nothing.
 *
 * With STRIPE_SECRET_KEY unset, the ledger simulator below runs the identical
 * state transitions with deterministic synthetic ids, so the commission flow,
 * splits, payouts and 1099 totals are exercisable end to end offline.
 */
const crypto = require('crypto');

const CURRENCY = 'usd';

function isLive() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

// ── Live provider ────────────────────────────────────────────────────────────
let stripeClient = null;
function stripe() {
  if (!stripeClient) {
    // Required lazily so the package is only needed when keys are configured.
    stripeClient = require('stripe')(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
  }
  return stripeClient;
}

const live = {
  mode: 'stripe',

  async createAccount({ email, country = 'US' }) {
    const account = await stripe().accounts.create({
      type: 'express',
      country,
      email,
      capabilities: { transfers: { requested: true } },
      business_type: 'individual',
    });
    return { accountId: account.id };
  },

  async accountLink({ accountId, refreshUrl, returnUrl }) {
    const link = await stripe().accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });
    return { url: link.url, expiresAt: new Date(link.expires_at * 1000).toISOString() };
  },

  async accountStatus({ accountId }) {
    const account = await stripe().accounts.retrieve(accountId);
    return {
      payoutsEnabled: Boolean(account.payouts_enabled),
      detailsSubmitted: Boolean(account.details_submitted),
      requirements: account.requirements?.currently_due || [],
    };
  },

  async chargeIntoEscrow({ amountCents, commissionId, buyerEmail, description }) {
    const intent = await stripe().paymentIntents.create({
      amount: amountCents,
      currency: CURRENCY,
      description,
      receipt_email: buyerEmail,
      // No transfer_data: funds land on the platform balance and are held there
      // until the buyer confirms delivery.
      metadata: { commission_id: String(commissionId) },
      automatic_payment_methods: { enabled: true },
    }, { idempotencyKey: `commission-${commissionId}-charge` });

    return { paymentRef: intent.id, clientSecret: intent.client_secret, status: intent.status };
  },

  async paymentStatus({ paymentRef }) {
    const intent = await stripe().paymentIntents.retrieve(paymentRef);
    return { status: intent.status, paid: intent.status === 'succeeded' };
  },

  async transfer({ amountCents, destinationAccountId, commissionId, party }) {
    const tr = await stripe().transfers.create({
      amount: amountCents,
      currency: CURRENCY,
      destination: destinationAccountId,
      metadata: { commission_id: String(commissionId), party },
    }, { idempotencyKey: `commission-${commissionId}-${party}` });
    return { transferRef: tr.id };
  },

  async refund({ paymentRef, amountCents, commissionId }) {
    const rf = await stripe().refunds.create({
      payment_intent: paymentRef,
      ...(amountCents ? { amount: amountCents } : {}),
    }, { idempotencyKey: `commission-${commissionId}-refund` });
    return { refundRef: rf.id, status: rf.status };
  },
};

// ── Ledger simulator ─────────────────────────────────────────────────────────
// Deterministic ids derived from the commission, so nothing needs to be held in
// memory and the same call twice is the same result - the local equivalent of
// Stripe's idempotency keys.
function simId(prefix, ...parts) {
  const digest = crypto.createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 24);
  return `${prefix}_sim_${digest}`;
}

const simulated = {
  mode: 'simulated',

  async createAccount({ email }) {
    return { accountId: simId('acct', email) };
  },

  async accountLink({ accountId, returnUrl }) {
    // Nothing to onboard against, so send the user straight back. The route that
    // calls this marks the account payouts-enabled, mirroring the webhook.
    return { url: `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}simulated=1&account=${accountId}`,
             expiresAt: new Date(Date.now() + 3600_000).toISOString() };
  },

  async accountStatus({ accountId }) {
    return { payoutsEnabled: true, detailsSubmitted: true, requirements: [], simulated: true, accountId };
  },

  async chargeIntoEscrow({ amountCents, commissionId }) {
    const paymentRef = simId('pi', commissionId, amountCents);
    return { paymentRef, clientSecret: `${paymentRef}_secret`, status: 'requires_confirmation' };
  },

  async paymentStatus({ paymentRef }) {
    return { status: 'succeeded', paid: true, simulated: true, paymentRef };
  },

  async transfer({ commissionId, party, amountCents }) {
    return { transferRef: simId('tr', commissionId, party, amountCents) };
  },

  async refund({ commissionId, amountCents }) {
    return { refundRef: simId('re', commissionId, amountCents), status: 'succeeded' };
  },
};

/** The active provider. Resolved per call so tests can flip the env var. */
function provider() {
  return isLive() ? live : simulated;
}

module.exports = new Proxy({}, {
  get(_target, prop) {
    if (prop === 'isLive') return isLive;
    if (prop === 'mode') return provider().mode;
    const impl = provider()[prop];
    return typeof impl === 'function' ? impl.bind(provider()) : impl;
  },
});
