require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const rateLimit = require('express-rate-limit');
const cron      = require('node-cron');

const { initDB } = require('./db/database');

const app  = express();
const PORT = process.env.PORT || 4001;

app.set('trust proxy', 1);

// Webhooks first: they need the raw body, and express.json() would consume it.
app.use('/api/webhooks', require('./routes/webhooks'));

app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false }));
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? (process.env.FRONTEND_URL || true) : true,
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

app.use('/api/auth',        require('./routes/auth'));
app.use('/api/photos',      require('./routes/photos'));
app.use('/api/painters',    require('./routes/painters'));
app.use('/api/commissions', require('./routes/commissions'));
app.use('/api/registry',    require('./routes/registry'));
app.use('/api/tax',         require('./routes/tax'));

app.get('/health', (_req, res) => {
  const payments = require('./services/payments');
  const images   = require('./services/images');
  res.json({
    status: 'ok',
    payments: payments.mode,
    imagePipeline: images.hasPipeline() ? 'sharp' : 'none - photographers supply display copies',
    registryKey: require('./services/signing').keyId(),
    timestamp: new Date().toISOString(),
  });
});

if (process.env.NODE_ENV === 'production') {
  const frontendPath = path.join(__dirname, '..', 'frontend', 'dist');
  app.use(express.static(frontendPath));
  app.get('*', (_req, res) => res.sendFile(path.join(frontendPath, 'index.html')));
}

// Anything that escaped a route handler. Domain errors are caught in the routes
// and returned as 400s; reaching here means a bug, so it is logged in full and
// reported without internals.
app.use((err, _req, res, _next) => {
  console.error('[unhandled]', err);
  res.status(500).json({ error: 'Something went wrong on our side' });
});

if (require.main === module) {
  (async () => {
    await initDB();
    require('./seed').seed();

    // Escrow cannot sit open because a buyer stopped reading their email.
    cron.schedule('0 * * * *', async () => {
      try {
        const settled = await require('./services/commissions').sweepAutoAccept();
        if (settled.length) console.log(`[escrow] Auto-accepted and settled: ${settled.join(', ')}`);
      } catch (err) {
        console.error('[escrow] Auto-accept sweep failed:', err.message);
      }
    });

    app.listen(PORT, () => {
      const payments = require('./services/payments');
      console.log(`\nDaub API on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`Payments:    ${payments.mode}${payments.isLive() ? '' : '  (set STRIPE_SECRET_KEY for live Connect)'}`);
      console.log(`Escrow:      auto-accept after ${require('./services/config').autoAcceptDays} days\n`);
    });
  })();
}

module.exports = app;
