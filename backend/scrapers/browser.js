/**
 * Shared Chromium launcher with puppeteer-extra stealth plugin.
 * Finds the system Chromium binary (installed via nixpacks) and launches
 * a browser that looks like a real desktop Chrome to bypass bot detection.
 */
const puppeteer  = require('puppeteer-extra');
const Stealth    = require('puppeteer-extra-plugin-stealth');
const { execSync } = require('child_process');

puppeteer.use(Stealth());

function findChromium() {
  // Prefer an explicit env override (set CHROMIUM_PATH on Railway if needed)
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;

  const cmds = [
    'which chromium',
    'which chromium-browser',
    'which google-chrome',
    'which google-chrome-stable',
  ];
  for (const cmd of cmds) {
    try {
      const p = execSync(cmd, { stdio: ['pipe','pipe','ignore'] }).toString().trim();
      if (p) return p;
    } catch {}
  }
  // Nix store fallback glob — chromium leaves a wrapper in PATH but the real binary
  // is deep in /nix/store. The wrapper is all we need.
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
