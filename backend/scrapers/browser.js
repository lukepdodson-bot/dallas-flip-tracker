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
  const { execSync } = require('child_process');
  const path = require('path');
  const fs   = require('fs');

  // 1. Explicit env override
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH))
    return process.env.CHROMIUM_PATH;

  // 2. puppeteer's executablePath() — respects PUPPETEER_CACHE_DIR
  try {
    const p = executablePath();
    if (p && fs.existsSync(p)) return p;
    console.log('[Browser] puppeteer.executablePath() =>', p || 'empty');
  } catch (e) {
    console.log('[Browser] executablePath() error:', e.message.split('\n')[0]);
  }

  // 3. Search known candidate directories for a chrome binary
  const searchDirs = [
    process.env.PUPPETEER_CACHE_DIR,
    path.join(__dirname, '..', '.chromium'),      // /app/backend/.chromium
    path.join(__dirname, '..', '..', '.chromium'), // /app/.chromium
    '/root/.cache/puppeteer',
    '/home/app/.cache/puppeteer',
    '/tmp/.chromium',
  ].filter(Boolean);

  for (const dir of searchDirs) {
    try {
      const found = execSync(
        `find "${dir}" -name 'chrome' -type f 2>/dev/null | head -1`,
        { stdio: ['pipe','pipe','ignore'] }
      ).toString().trim();
      if (found && fs.existsSync(found)) {
        console.log('[Browser] Found Chrome at:', found);
        return found;
      }
    } catch {}
  }

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
