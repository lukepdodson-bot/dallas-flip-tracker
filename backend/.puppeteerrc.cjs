const path = require('path');
/**
 * Tells puppeteer to store/find Chrome in backend/.chromium
 * (relative to this config file = backend/).
 * Both `npx puppeteer browsers install chrome` and executablePath() read this.
 */
module.exports = {
  cacheDirectory: path.join(__dirname, '.chromium'),
};
