/**
 * Stripe webhooks.
 *
 * Mounted before express.json() so the raw body survives for signature
 * verification - a parsed-and-restringified body will not match the signature.
 */
const express     = require('express');
const db          = require('../db/database');
const commissions = require('../services/commissions');

const router = express.Router();

router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !process.env.STRIPE_SECRET_KEY) {
    return res.status(503).json({ error: 'Stripe is not configured on this deployment' });
  }

  let event;
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret);
  } catch (err) {
    return res.status(400).json({ error: `Signature verification failed: ${err.message}` });
  }

  // Acknowledge first: Stripe retries on a slow response, and every handler
  // below is safe to run twice.
  res.json({ received: true, type: event.type });

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const commissionId = Number(event.data.object.metadata?.commission_id);
        if (commissionId) await commissions.confirmFunding(commissionId);
        break;
      }
      case 'account.updated': {
        const account = event.data.object;
        db.prepare('UPDATE users SET payouts_enabled = ? WHERE stripe_account_id = ?')
          .run(account.payouts_enabled ? 1 : 0, account.id);
        break;
      }
      case 'transfer.reversed': {
        const transfer = event.data.object;
        db.prepare(`UPDATE payouts SET state = 'reversed' WHERE transfer_ref = ?`).run(transfer.id);
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error(`[stripe] Handling ${event.type} failed:`, err.message);
  }
});

module.exports = router;
