/**
 * Commission split arithmetic.
 *
 * Every amount is integer cents. The painter takes the remainder rather than a
 * computed percentage, so platform + photographer + painter always sums exactly
 * to what the buyer paid - there is no penny left stranded in escrow and no
 * transfer that overdraws the platform balance.
 *
 * The photographer's floor price wins over the percentage. A photographer who
 * set a $150 floor on an image gets $150 on a $400 commission, not 10% of it.
 */

function bpsOf(cents, bps) {
  return Math.floor((cents * bps) / 10000);
}

/**
 * @param {object} opts
 * @param {number} opts.priceCents        buyer-facing commission price
 * @param {number} opts.photographerBps   royalty rate in basis points
 * @param {number} opts.platformBps       platform fee in basis points
 * @param {number} [opts.floorCents]      photographer's per-image floor
 * @returns {{priceCents, platformCents, photographerCents, painterCents,
 *            photographerBps, platformBps, floorApplied}}
 */
function splitCommission({ priceCents, photographerBps, platformBps, floorCents = 0 }) {
  if (!Number.isInteger(priceCents) || priceCents <= 0) {
    throw new Error('priceCents must be a positive integer number of cents');
  }
  if (photographerBps < 0 || platformBps < 0 || photographerBps + platformBps >= 10000) {
    throw new Error('Split rates must be non-negative and leave the painter a share');
  }

  const platformCents  = bpsOf(priceCents, platformBps);
  const byRate         = bpsOf(priceCents, photographerBps);
  const photographerCents = Math.max(byRate, floorCents);
  const painterCents   = priceCents - platformCents - photographerCents;

  if (painterCents <= 0) {
    throw new Error(
      `Price of ${fmt(priceCents)} leaves the painter nothing after a ` +
      `${fmt(photographerCents)} photographer share and ${fmt(platformCents)} platform fee`
    );
  }

  return {
    priceCents, platformCents, photographerCents, painterCents,
    photographerBps, platformBps,
    floorApplied: photographerCents > byRate,
  };
}

/**
 * Lowest buyer price at which a photo's floor still leaves the painter a
 * positive share. Used to tell a buyer why a cheap quote was rejected rather
 * than just refusing it.
 */
function minimumViablePrice({ photographerBps, platformBps, floorCents = 0 }) {
  // Analytic starting point: P*(1 - platformBps/1e4) > floor, then step up until
  // the exact integer arithmetic above actually clears. The loop runs a handful
  // of times at most - it exists to absorb floor() rounding, not to search.
  const denom = 1 - platformBps / 10000;
  let price = Math.max(1, Math.ceil(Math.max(floorCents, 1) / denom));
  for (let i = 0; i < 1000; i++) {
    try {
      splitCommission({ priceCents: price, photographerBps, platformBps, floorCents });
      return price;
    } catch {
      price++;
    }
  }
  throw new Error('No viable price exists for this floor and fee combination');
}

function fmt(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs  = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
}

module.exports = { splitCommission, minimumViablePrice, bpsOf, fmt };
