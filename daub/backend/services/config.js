/** Single place to read tunables, so nothing reaches for process.env inline. */
function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

module.exports = {
  get photographerRoyaltyBps() { return int('PHOTOGRAPHER_ROYALTY_BPS', 1000); },  // 10%
  get platformFeeBps()         { return int('PLATFORM_FEE_BPS', 1500); },          // 15%
  get autoAcceptDays()         { return int('AUTO_ACCEPT_DAYS', 7); },
  get publicUrl()              { return process.env.PUBLIC_URL || `http://localhost:${int('PORT', 4001)}`; },

  /**
   * 1099-NEC filing threshold. The OBBBA raised this from $600 to $2,000 for
   * payments made after 2025-12-31, indexed thereafter. Both figures are
   * configurable because the number moves and a wrong one is a filing problem,
   * not a rounding problem. Confirm the current year's figure with a CPA.
   */
  thresholdCentsFor(taxYear) {
    return taxYear >= 2026
      ? int('TAX_1099_NEC_THRESHOLD_CENTS', 200000)
      : int('TAX_1099_NEC_THRESHOLD_CENTS_PRE_2026', 60000);
  },
};
