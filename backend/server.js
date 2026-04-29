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

// Health check (must be before the frontend catch-all)
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Diagnostic: check Chromium availability (admin only)
app.get('/api/scrape/diagnostic', require('./routes/auth').requireAuth, (req, res) => {
  const { execSync } = require('child_process');
  const fs = require('fs');
  const checks = {};
  // System chrome checks
  for (const cmd of ['which chromium','which chromium-browser','which google-chrome']) {
    try { checks[cmd] = execSync(cmd, { stdio: ['pipe','pipe','ignore'] }).toString().trim(); }
    catch { checks[cmd] = 'not found'; }
  }
  // Puppeteer executable path
  try {
    const { executablePath } = require('puppeteer');
    const p = executablePath();
    checks['puppeteer.executablePath()'] = p;
    checks['puppeteer binary exists'] = fs.existsSync(p) ? 'YES' : 'NO';
  } catch(e) { checks['puppeteer.executablePath()'] = 'error: ' + e.message; }
  // Cache dir contents
  try {
    const cacheDir = process.env.PUPPETEER_CACHE_DIR || '';
    checks['PUPPETEER_CACHE_DIR'] = cacheDir;
    if (cacheDir) checks['cache dir exists'] = fs.existsSync(cacheDir) ? 'YES' : 'NO';
    // find chrome binary recursively
    const found = execSync(`find ${cacheDir || '/app/backend/.chromium'} -name 'chrome' -type f 2>/dev/null | head -3`, { stdio: ['pipe','pipe','ignore'] }).toString().trim();
    checks['chrome binary found at'] = found || 'none';
  } catch(e) { checks['cache search'] = 'error: ' + e.message; }
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
  cron.schedule('0 12 * * *', async () => {
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
