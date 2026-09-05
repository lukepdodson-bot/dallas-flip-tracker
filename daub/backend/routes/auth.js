const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const db       = require('../db/database');
const payments = require('../services/payments');

const router = express.Router();

const JWT_SECRET   = process.env.JWT_SECRET || 'dev_secret_change_in_production';
const TOKEN_EXPIRY = '30d';
const ROLES = ['photographer', 'painter', 'buyer'];

function issueToken(user) {
  return jwt.sign({ userId: user.id, email: user.email, roles: user.roles }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

function publicUser(user) {
  return {
    id: user.id, email: user.email, name: user.name,
    roles: String(user.roles || '').split(',').filter(Boolean),
    legalName: user.legal_name,
    payoutsEnabled: Boolean(user.payouts_enabled),
    hasPayoutAccount: Boolean(user.stripe_account_id),
  };
}

// POST /api/auth/register
router.post('/register', (req, res) => {
  const { email, password, name, roles = ['buyer'], legalName } = req.body || {};

  if (!email || !password || !name) return res.status(400).json({ error: 'Email, password and name are required' });
  if (String(password).length < 8)   return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const wanted = (Array.isArray(roles) ? roles : [roles]).filter(r => ROLES.includes(r));
  if (!wanted.length) return res.status(400).json({ error: `Pick at least one role: ${ROLES.join(', ')}` });

  const normalised = String(email).toLowerCase().trim();
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(normalised)) {
    return res.status(409).json({ error: 'An account with that email already exists' });
  }

  const result = db.tx(() => {
    const insert = db.prepare(`
      INSERT INTO users (email, name, password_hash, roles, legal_name) VALUES (?, ?, ?, ?, ?)
    `).run(normalised, String(name).trim(), bcrypt.hashSync(password, 10), wanted.join(','), legalName || null);

    // A painter is not browsable until they have a profile, so create the empty
    // one now rather than leaving a painter who never opened settings invisible.
    if (wanted.includes('painter')) {
      db.prepare('INSERT INTO painter_profiles (user_id) VALUES (?)').run(insert.lastInsertRowid);
    }
    return insert.lastInsertRowid;
  });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result);
  res.status(201).json({ token: issueToken(user), user: publicUser(user) });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  res.json({ token: issueToken(user), user: publicUser(user) });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => res.json(publicUser(req.currentUser)));

// POST /api/auth/payout-account - start (or resume) Stripe Connect onboarding
router.post('/payout-account', requireAuth, async (req, res) => {
  const user = req.currentUser;
  const roles = String(user.roles).split(',');
  if (!roles.includes('painter') && !roles.includes('photographer')) {
    return res.status(400).json({ error: 'Only painters and photographers receive payouts' });
  }

  try {
    let accountId = user.stripe_account_id;
    if (!accountId) {
      ({ accountId } = await payments.createAccount({ email: user.email, country: user.country || 'US' }));
      db.prepare('UPDATE users SET stripe_account_id = ? WHERE id = ?').run(accountId, user.id);
    }

    const base = process.env.FRONTEND_URL || 'http://localhost:5174';
    const link = await payments.accountLink({
      accountId,
      refreshUrl: `${base}/settings/payouts?refresh=1`,
      returnUrl:  `${base}/settings/payouts?done=1`,
    });

    // The simulator has nothing to onboard against, so it reports ready
    // immediately - the same thing the account.updated webhook does live.
    if (!payments.isLive()) {
      db.prepare('UPDATE users SET payouts_enabled = 1 WHERE id = ?').run(user.id);
    }

    res.json({ accountId, url: link.url, simulated: !payments.isLive() });
  } catch (err) {
    res.status(502).json({ error: `Could not start payout onboarding: ${err.message}` });
  }
});

// GET /api/auth/payout-account
router.get('/payout-account', requireAuth, async (req, res) => {
  const user = req.currentUser;
  if (!user.stripe_account_id) return res.json({ connected: false, payoutsEnabled: false });

  try {
    const status = await payments.accountStatus({ accountId: user.stripe_account_id });
    db.prepare('UPDATE users SET payouts_enabled = ? WHERE id = ?').run(status.payoutsEnabled ? 1 : 0, user.id);
    res.json({ connected: true, ...status });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// PATCH /api/auth/me - name, legal name, taxpayer id tail
router.patch('/me', requireAuth, (req, res) => {
  const { name, legalName, taxIdLast4 } = req.body || {};
  const tail = taxIdLast4 ? String(taxIdLast4).replace(/\D/g, '').slice(-4) : undefined;
  if (taxIdLast4 && tail.length !== 4) return res.status(400).json({ error: 'Give the last four digits of your taxpayer ID' });

  db.prepare(`
    UPDATE users SET name = COALESCE(?, name), legal_name = COALESCE(?, legal_name),
                     tax_id_last4 = COALESCE(?, tax_id_last4)
     WHERE id = ?
  `).run(name || null, legalName || null, tail ?? null, req.currentUser.id);

  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.currentUser.id)));
});

// ── Middleware ───────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required' });

  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Roles are read from the row, not the token, so a role change takes effect
  // without waiting 30 days for the token to expire.
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.userId);
  if (!user) return res.status(401).json({ error: 'Account no longer exists' });
  req.currentUser = user;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    const held = String(req.currentUser.roles || '').split(',');
    if (!roles.some(role => held.includes(role))) {
      return res.status(403).json({ error: `This needs a ${roles.join(' or ')} account` });
    }
    next();
  };
}

/** Attaches req.currentUser when a token is present, but never rejects. */
function optionalAuth(req, _res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      const claims = jwt.verify(header.slice(7), JWT_SECRET);
      req.currentUser = db.prepare('SELECT * FROM users WHERE id = ?').get(claims.userId) || undefined;
    } catch { /* anonymous */ }
  }
  next();
}

module.exports = router;
module.exports.requireAuth   = requireAuth;
module.exports.requireRole   = requireRole;
module.exports.optionalAuth  = optionalAuth;
module.exports.publicUser    = publicUser;
