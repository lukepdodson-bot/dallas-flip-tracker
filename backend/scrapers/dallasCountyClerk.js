/**
 * Legacy entry point — kept for backwards compatibility.
 * All county-clerk scraping logic now lives in countyClerk.js (multi-county).
 */
const { scrapeCountyClerkForeclosures, nextFirstTuesdays } = require('./countyClerk');

module.exports = {
  // Old name → new function (still scrapes Dallas as part of the multi-county loop)
  scrapeDallasCountyForeclosures: scrapeCountyClerkForeclosures,
  nextFirstTuesdays,
};
