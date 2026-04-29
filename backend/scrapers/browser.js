/**
 * Shared Chromium launcher with puppeteer-extra stealth plugin.
 *
 * Chrome is downloaded during the nixpacks BUILD phase via:
 *   PUPPETEER_CACHE_DIR=/app/backend/.chromium npx puppeteer browsers install chrome
 *
 * At runtime the same env var points puppeteer.executablePath() at the cached binary.
 */
const puppeteer  = require('puppeteer-extra');
const Stealth    = require('puppeteer-extra-plugin-stealth');
const { executablePath } = require('puppeteer');

puppeteer.use(Stealth());

function findChromium() {
  // Explicit override (e.g. CHROMIUM_PATH env var on Railway)
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;

  // puppeteer's own executablePath() respects PUPPETEER_CACHE_DIR
  try {
    const p = executablePath();
    if (p) return p;
  } catch {}

  return null;
}

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--disable-gpu',
  '--no-first-run',
  '--no-zygote',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-sync',
  '--disable-translate',
  '--hide-scrollbars',
  '--mute-audio',
  '--safebrowsing-disable-auto-update',
  '--window-size=1366,768',
];

async function launchBrowser() {
  const executablePath = findChromium();
  if (!executablePath) {
    throw new Error(
      'Chromium not found. Add CHROMIUM_PATH env var or ensure nixpacks installs chromium.'
    );
  }
  console.log(`[Browser] Using Chromium at: ${executablePath}`);
  return puppeteer.launch({
    executablePath,
    headless: 'new',
    args: LAUNCH_ARGS,
    timeout: 60000,
    ignoreHTTPSErrors: true,
  });
}

/**
 * Create a new page with realistic desktop headers.
 */
async function newPage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 768 });
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
  });
  // Random-ish delay between actions to look human
  page.humanDelay = () =>
    new Promise(r => setTimeout(r, 800 + Math.random() * 1200));
  return page;
}

module.exports = { launchBrowser, newPage };
