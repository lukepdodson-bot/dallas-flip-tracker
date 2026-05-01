require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const db         = require('./db/database');
const { initDB } = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3001;

// Trust proxy for rate limiting behind nginx/etc
app.set('trust proxy', 1);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', limiter);

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? process.env.FRONTEND_URL || true
    : true,
  credentials: true,
}));
app.use(express.json());

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/properties', require('./routes/properties'));

// Scrape status endpoint
app.get('/api/scrape/status', require('./routes/auth').requireAuth, (req, res) => {
  const logs = db.prepare(`
    SELECT * FROM scrape_log ORDER BY started_at DESC LIMIT 20
  `).all();
  res.json(logs);
});

// Trigger manual scrape (admin only)
app.post('/api/scrape/run', require('./routes/auth').requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  res.json({ message: 'Scrape started in background' });

  // Run async without blocking response
  const { runAllScrapers } = require('./scrapers/index');
  runAllScrapers().catch(console.error);
});

// Trigger geocoding only (admin only)
app.post('/api/geocode/run', require('./routes/auth').requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const { geocodeUngeocodedProperties } = require('./scrapers/geocoder');
    const before = db.prepare('SELECT COUNT(*) as c FROM properties WHERE lat IS NULL OR lng IS NULL').get();
    res.json({ message: 'Geocoding started', ungeocodedBefore: before.c });
    geocodeUngeocodedProperties(db).catch(console.error);
  } catch (e) {
    res.json({ error: e.message });
  }
});

// Trigger owner enrichment (admin only). Pass ?retry=1 to retry failed lookups.
app.post('/api/owners/enrich', require('./routes/auth').requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const { enrichOwners } = require('./scrapers/ownerLookup');
    if (req.query.retry === '1') {
      const r = db.prepare("UPDATE properties SET owner_lookup_attempted=NULL WHERE owner_name IS NULL OR owner_name=''").run();
      console.log(`[Owners] Reset ${r.changes} attempt flags for retry`);
    }
    const before = db.prepare("SELECT COUNT(*) as c FROM properties WHERE owner_name IS NULL OR owner_name = ''").get();
    res.json({ message: 'Owner enrichment started', missingOwnersBefore: before.c });
    enrichOwners(db, { limit: 100, includePhone: true }).catch(console.error);
  } catch (e) {
    res.json({ error: e.message });
  }
});

// Test DCAD lookup for one address (admin only)
app.get('/api/owners/test', require('./routes/auth').requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const { launchBrowser, newPage } = require('./scrapers/browser');
    const { scrapeDCAD, skipTracePhone } = require('./scrapers/ownerLookup');
    const address = req.query.address || '549 Sharp Dr';
    const city    = req.query.city    || 'DeSoto';
    const debug   = req.query.debug   === '1';
    const browser = await launchBrowser();

    if (debug) {
      // Walk DCAD: search → first result → dump detail page text
      const page = await newPage(browser);
      await page.goto('https://www.dallascad.org/SearchAddr.aspx', { waitUntil: 'networkidle2', timeout: 30000 });
      const m = address.match(/^(\d+)\s+(.+)$/);
      const streetNum = m ? m[1] : '';
      const streetName = m ? m[2].replace(/\s+(Dr|Drive|St|Street|Ave|Avenue|Ln|Lane|Rd|Road|Blvd|Boulevard|Ct|Court|Cir|Circle|Pl|Place|Way|Pkwy|Trl|Trail|Ter|Sq)\.?$/i,'').trim() : '';
      const cityUpper = (city || '').toUpperCase().trim();

      await page.click('#txtAddrNum');
      await page.type('#txtAddrNum', streetNum, { delay: 30 });
      await page.click('#txtStName');
      await page.type('#txtStName', streetName, { delay: 30 });
      if (cityUpper) {
        await page.evaluate((cityVal) => {
          const sel = document.getElementById('listCity');
          if (!sel) return;
          const opt = Array.from(sel.options).find(o => o.text.trim().toUpperCase() === cityVal);
          if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
        }, cityUpper);
      }
      await Promise.all([
        page.click('#cmdSubmit'),
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
      ]);
      const url1 = page.url();
      const onDetail1 = url1.includes('AcctDetail') || url1.includes('acctdetail');
      let url2 = null, detailText = null, allLinks = null;
      if (!onDetail1) {
        // Get links on results page
        allLinks = await page.evaluate(() => Array.from(document.querySelectorAll('a')).map(a => ({ text: a.innerText.trim().substring(0,40), href: a.href })).filter(l => l.href && !l.href.startsWith('javascript:')).slice(0, 20));
        const firstHref = await page.evaluate(() => {
          const link = document.querySelector('a[href*="AcctDetail" i], a[href*="acctdetail" i]');
          return link ? link.href : null;
        });
        if (firstHref) {
          await page.goto(firstHref, { waitUntil: 'networkidle2', timeout: 30000 });
          url2 = page.url();
          detailText = await page.evaluate(() => (document.body.innerText || '').substring(0, 5000));
        }
      } else {
        url2 = url1;
        detailText = await page.evaluate(() => (document.body.innerText || '').substring(0, 5000));
      }

      await browser.close();
      return res.json({ address, city, streetNum, streetName, cityUpper, url1, url2, allLinks, detailText });
    }

    const dcad = await scrapeDCAD(browser, address, city);
    let phone = null;
    if (dcad?.owner_name) phone = await skipTracePhone(browser, dcad.owner_name, city);
    await browser.close();
    res.json({ address, city, dcad, phone });
  } catch (e) {
    res.json({ error: e.message.substring(0, 500) });
  }
});

// Test single geocode (admin only) — diagnostic
app.get('/api/geocode/test', require('./routes/auth').requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const { geocodeAddress } = require('./scrapers/geocoder');
    const address = req.query.address || '549 Sharp Dr';
    const city    = req.query.city    || 'Desoto';
    const result = await geocodeAddress(address, city, 'TX');
    res.json({ address, city, result });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// Health check (must be before the frontend catch-all)
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Debug scrape: actually launch Chrome and return page info (admin only)
app.get('/api/scrape/test', require('./routes/auth').requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const { launchBrowser, newPage } = require('./scrapers/browser');
    const browser = await launchBrowser();
    const page = await newPage(browser);
    const url = req.query.url || 'https://www.hudhomestore.gov';
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    const title = await page.title();
    const html  = await page.content();
    await browser.close();

    // Search for property-related content in full HTML
    const keywords = ['address', 'price', 'bedroom', 'bath', 'sqft', 'listing', 'auction', 'foreclosure', 'Dallas', 'property', 'asset', 'parcel'];
    const snippets = {};
    for (const kw of keywords) {
      const idx = html.toLowerCase().indexOf(kw.toLowerCase());
      if (idx !== -1) snippets[kw] = html.substring(Math.max(0, idx - 50), idx + 200);
    }

    res.json({
      url, title,
      htmlLength: html.length,
      htmlStart: html.substring(0, 1000),
      htmlMid: html.substring(Math.floor(html.length / 2), Math.floor(html.length / 2) + 1000),
      htmlEnd: html.substring(Math.max(0, html.length - 1000)),
      hasTable: html.includes('<table'),
      keywordSnippets: snippets,
    });
  } catch (e) {
    res.json({ error: e.message.substring(0, 500) });
  }
});

// Diagnostic: check Chromium availability (admin only)
app.get('/api/scrape/diagnostic', require('./routes/auth').requireAuth, (req, res) => {
  const { execSync } = require('child_process');
  const fs = require('fs');
  const checks = {};
  // System chrome checks
  for (const cmd of ['which chromium','which chromium-browser','which google-chrome-stable','which google-chrome']) {
    try { checks[cmd] = execSync(cmd, { stdio: ['pipe','pipe','ignore'] }).toString().trim(); }
    catch { checks[cmd] = 'not found'; }
  }
  // Nix store search
  try {
    const nixFind = execSync('find /nix/store -maxdepth 3 -name "chromium" -type f 2>/dev/null | head -3', { stdio: ['pipe','pipe','ignore'] }).toString().trim();
    checks['nix store chromium'] = nixFind || 'none';
  } catch(e) { checks['nix store chromium'] = 'error: ' + e.message; }
  // Puppeteer executable path
  try {
    const { executablePath } = require('puppeteer');
    const p = executablePath();
    checks['puppeteer.executablePath()'] = p;
    checks['puppeteer binary exists'] = fs.existsSync(p) ? 'YES' : 'NO';
    if (fs.existsSync(p)) {
      try { checks['file type'] = execSync(`file "${p}" 2>/dev/null`, { stdio: ['pipe','pipe','ignore'] }).toString().trim().split(': ')[1] || 'unknown'; } catch {}
      try { checks['ldd missing libs'] = execSync(`ldd "${p}" 2>/dev/null | grep 'not found' | head -5`, { stdio: ['pipe','pipe','ignore'] }).toString().trim() || 'none (all libs found)'; } catch {}
      try { const stat = fs.statSync(p); checks['file permissions'] = '0' + (stat.mode & 0o777).toString(8); checks['is executable'] = !!(stat.mode & 0o111); } catch {}
      try {
        const { spawnSync } = require('child_process');
        const r = spawnSync(p, ['--version', '--no-sandbox', '--disable-setuid-sandbox'], { timeout: 8000, encoding: 'utf8' });
        checks['version stdout'] = (r.stdout || '').trim().substring(0, 200) || 'empty';
        checks['version stderr'] = (r.stderr || '').trim().substring(0, 400) || 'empty';
        checks['version exit'] = r.status;
        checks['version spawn error'] = r.error ? r.error.message.substring(0, 200) : 'none';
      } catch(e) { checks['version run error'] = e.message.substring(0, 300); }
    }
  } catch(e) { checks['puppeteer.executablePath()'] = 'error: ' + e.message; }
  // Cache dir contents
  try {
    const found = execSync(`find /root/.cache/puppeteer -name 'chrome' -type f 2>/dev/null | head -3`, { stdio: ['pipe','pipe','ignore'] }).toString().trim();
    checks['puppeteer cache chrome'] = found || 'none';
  } catch(e) { checks['puppeteer cache search'] = 'error: ' + e.message; }
  res.json({ env: { PUPPETEER_CACHE_DIR: process.env.PUPPETEER_CACHE_DIR, CHROMIUM_PATH: process.env.CHROMIUM_PATH }, checks });
});

// Serve React frontend in production
if (process.env.NODE_ENV === 'production') {
  const frontendPath = path.join(__dirname, '..', 'frontend', 'dist');
  app.use(express.static(frontendPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
  });
}

// Boot: init DB first, then start listening
(async () => {
  console.log('Initialising database...');
  await initDB();
  console.log('Database ready.');

  // Seed on first run (idempotent)
  try { require('./seed'); } catch (e) { console.error('Seed error:', e.message); }

  // Daily scrape at 6 AM Central
  cron.schedule('0 6 * * *', async () => {
    console.log('[Cron] Running daily scrape...');
    try {
      const { runAllScrapers } = require('./scrapers/index');
      await runAllScrapers();
    } catch (e) {
      console.error('[Cron] Scrape error:', e.message);
    }
  }, { timezone: 'America/Chicago' });

  app.listen(PORT, () => {
    console.log(`\nDallas Foreclosure Tracker running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Daily scrape: 6:00 AM Central\n`);
  });
})();
