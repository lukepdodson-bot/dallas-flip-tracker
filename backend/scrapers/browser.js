/**
 * Shared Chromium launcher with puppeteer-extra stealth plugin.
 *
 * Chromium is provided via nixPkgs in nixpacks.toml.
 * CHROMIUM_PATH env var can override the auto-detected path.
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
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) {
    console.log('[Browser] Using CHROMIUM_PATH env:', process.env.CHROMIUM_PATH);
    return process.env.CHROMIUM_PATH;
  }

  // 2. nixpkgs system chromium (most reliable on Railway)
  for (const cmd of ['which chromium', 'which chromium-browser', 'which google-chrome-stable', 'which google-chrome']) {
    try {
      const p = execSync(cmd, { stdio: ['pipe','pipe','ignore'] }).toString().trim();
      if (p && fs.existsSync(p)) {
        console.log('[Browser] Found system chromium at:', p);
        return p;
      }
    } catch {}
  }

  // 3. Common nixpkgs Nix store paths for chromium
  try {
    const nixFind = execSync(
      'find /nix/store -maxdepth 3 -name "chromium" -type f 2>/dev/null | head -3',
      { stdio: ['pipe','pipe','ignore'] }
    ).toString().trim();
    if (nixFind) {
      const first = nixFind.split('\n')[0];
      if (first && fs.existsSync(first)) {
        console.log('[Browser] Found chromium in /nix/store:', first);
        return first;
      }
    }
  } catch {}

  // 4. puppeteer.executablePath() — downloaded Chrome (may have glibc compat issues)
  try {
    const p = executablePath();
    if (p && fs.existsSync(p)) {
      console.log('[Browser] Using puppeteer executablePath:', p);
      return p;
    }
    console.log('[Browser] executablePath() returned:', p, '(exists:', fs.existsSync(p||''), ')');
  } catch (e) {
    console.log('[Browser] executablePath() error:', e.message.split('\n')[0]);
  }

  // 5. Broad search in common locations
  const searchDirs = [
    path.join(__dirname, '..', '.chromium'),
    path.join(__dirname, '..', '..', '.chromium'),
    '/root/.cache/puppeteer',
    process.env.PUPPETEER_CACHE_DIR,
  ].filter(Boolean);

  for (const dir of searchDirs) {
    try {
      const found = execSync(
        `find "${dir}" -name 'chrome' -type f 2>/dev/null | head -1`,
        { stdio: ['pipe','pipe','ignore'] }
      ).toString().trim();
      if (found && fs.existsSync(found)) {
        console.log('[Browser] Found Chrome by search in', dir, ':', found);
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
  const execPath = findChromium();
  if (!execPath) {
    throw new Error(
      'Chromium not found. Add CHROMIUM_PATH env var or ensure nixpacks.toml has nixPkgs = ["chromium"].'
    );
  }
  console.log(`[Browser] Launching Chromium at: ${execPath}`);
  return puppeteer.launch({
    executablePath: execPath,
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
