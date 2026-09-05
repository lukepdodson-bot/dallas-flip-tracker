/**
 * Schema for the commission leg (Leg A).
 *
 * Money is always integer cents. Percentages are always basis points (bps),
 * 1/100th of a percent, so 1000 bps = 10%. Nothing in this system stores a
 * float for money - splits have to reconcile to the penny against Stripe.
 *
 * SKU columns exist for every tier in the licensing table even though only
 * `commission` is transactable today: photographers need the toggles and floor
 * prices from day one (MVP item 1), and Leg B should not require a migration.
 */

const SKUS = ['commission', 'reference', 'exclusive_timeboxed', 'exclusive_scoped', 'exclusive_permanent', 'reproduction', 'print'];

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     email TEXT UNIQUE NOT NULL,
     name TEXT NOT NULL,
     password_hash TEXT NOT NULL,
     roles TEXT NOT NULL DEFAULT 'buyer',        -- comma-separated: photographer,painter,buyer,admin
     country TEXT DEFAULT 'US',
     stripe_account_id TEXT,
     payouts_enabled INTEGER DEFAULT 0,
     tax_id_last4 TEXT,
     legal_name TEXT,
     created_at TEXT DEFAULT (datetime('now'))
   )`,

  `CREATE TABLE IF NOT EXISTS painter_profiles (
     user_id INTEGER PRIMARY KEY,
     bio TEXT,
     mediums TEXT DEFAULT '[]',                  -- JSON array: oil, acrylic, watercolour, gouache...
     min_price_cents INTEGER DEFAULT 0,
     max_price_cents INTEGER,
     turnaround_days INTEGER DEFAULT 30,
     accepting INTEGER DEFAULT 1,
     portfolio TEXT DEFAULT '[]',                -- JSON array of {url, title, medium, year}
     location TEXT,
     updated_at TEXT DEFAULT (datetime('now')),
     FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
   )`,

  `CREATE TABLE IF NOT EXISTS photos (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     photographer_id INTEGER NOT NULL,
     title TEXT NOT NULL,
     description TEXT,
     tags TEXT DEFAULT '[]',                     -- JSON array
     orientation TEXT,                           -- portrait | landscape | square
     width INTEGER, height INTEGER,
     -- Three renditions. licensed_file is full-resolution and never leaves the
     -- server without an executed licence; display_file is the public web copy.
     -- RAW is rejected at upload: painters do not need sensor data, and it strips
     -- out the photographer's own colour and tonal decisions.
     licensed_file TEXT, display_file TEXT, thumb_file TEXT,
     licensed_sha256 TEXT,
     status TEXT NOT NULL DEFAULT 'draft',       -- draft | published | withdrawn
     shot_for_painting INTEGER DEFAULT 0,        -- even light, clear value structure
     exclusivity_state TEXT DEFAULT 'open',      -- open | encumbered (Leg B)
     created_at TEXT DEFAULT (datetime('now')),
     updated_at TEXT DEFAULT (datetime('now')),
     FOREIGN KEY (photographer_id) REFERENCES users(id) ON DELETE CASCADE
   )`,

  `CREATE TABLE IF NOT EXISTS photo_skus (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     photo_id INTEGER NOT NULL,
     sku TEXT NOT NULL,
     enabled INTEGER NOT NULL DEFAULT 0,
     floor_price_cents INTEGER NOT NULL DEFAULT 0,
     notes TEXT,
     UNIQUE(photo_id, sku),
     FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
   )`,

  `CREATE TABLE IF NOT EXISTS license_templates (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     tier TEXT NOT NULL,
     version TEXT NOT NULL,
     title TEXT NOT NULL,
     body TEXT NOT NULL,                         -- clause template, {{placeholders}}
     active INTEGER DEFAULT 1,
     created_at TEXT DEFAULT (datetime('now')),
     UNIQUE(tier, version)
   )`,

  `CREATE TABLE IF NOT EXISTS licenses (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     photo_id INTEGER NOT NULL,
     licensee_id INTEGER NOT NULL,               -- the painter
     buyer_id INTEGER,                           -- single-use licences name the buyer
     photographer_id INTEGER NOT NULL,
     commission_id INTEGER,
     tier TEXT NOT NULL DEFAULT 'single_use',
     template_id INTEGER,
     terms TEXT NOT NULL,                        -- canonical JSON of the resolved terms
     terms_hash TEXT NOT NULL,                   -- sha256 of the canonical terms
     watermark_id TEXT NOT NULL,                 -- ties every delivered file to this licence
     status TEXT NOT NULL DEFAULT 'pending',     -- pending | executed | void
     issued_at TEXT DEFAULT (datetime('now')),
     executed_at TEXT,
     expires_at TEXT,
     pdf_file TEXT,
     platform_signature TEXT,                    -- Ed25519 countersignature over terms_hash
     FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
     FOREIGN KEY (licensee_id) REFERENCES users(id) ON DELETE CASCADE
   )`,

  `CREATE TABLE IF NOT EXISTS license_signatures (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     license_id INTEGER NOT NULL,
     party TEXT NOT NULL,                        -- photographer | painter | buyer
     user_id INTEGER NOT NULL,
     typed_name TEXT NOT NULL,
     signed_at TEXT DEFAULT (datetime('now')),
     ip TEXT,
     user_agent TEXT,
     signature_hash TEXT NOT NULL,
     UNIQUE(license_id, party),
     FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE CASCADE
   )`,

  `CREATE TABLE IF NOT EXISTS commissions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     buyer_id INTEGER NOT NULL,
     photo_id INTEGER NOT NULL,
     painter_id INTEGER NOT NULL,
     photographer_id INTEGER NOT NULL,
     license_id INTEGER,
     medium TEXT, size TEXT,
     brief TEXT,
     price_cents INTEGER NOT NULL,
     photographer_cents INTEGER NOT NULL,
     platform_cents INTEGER NOT NULL,
     painter_cents INTEGER NOT NULL,
     photographer_bps INTEGER NOT NULL,
     platform_bps INTEGER NOT NULL,
     state TEXT NOT NULL DEFAULT 'quoted',
     escrow_state TEXT NOT NULL DEFAULT 'none',  -- none | held | released | refunded
     payment_ref TEXT,                           -- Stripe PaymentIntent id
     delivered_at TEXT,
     auto_accept_at TEXT,
     accepted_at TEXT,
     settled_at TEXT,
     cancel_reason TEXT,
     created_at TEXT DEFAULT (datetime('now')),
     updated_at TEXT DEFAULT (datetime('now')),
     FOREIGN KEY (buyer_id) REFERENCES users(id),
     FOREIGN KEY (photo_id) REFERENCES photos(id),
     FOREIGN KEY (painter_id) REFERENCES users(id)
   )`,

  `CREATE TABLE IF NOT EXISTS commission_events (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     commission_id INTEGER NOT NULL,
     from_state TEXT, to_state TEXT NOT NULL,
     actor_id INTEGER, actor_role TEXT,
     note TEXT,
     created_at TEXT DEFAULT (datetime('now')),
     FOREIGN KEY (commission_id) REFERENCES commissions(id) ON DELETE CASCADE
   )`,

  `CREATE TABLE IF NOT EXISTS milestones (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     commission_id INTEGER NOT NULL,
     kind TEXT NOT NULL,                         -- underpainting | progress | finished | shipped
     label TEXT NOT NULL,
     state TEXT NOT NULL DEFAULT 'pending',      -- pending | complete
     image_file TEXT,
     note TEXT,
     completed_at TEXT,
     position INTEGER DEFAULT 0,
     FOREIGN KEY (commission_id) REFERENCES commissions(id) ON DELETE CASCADE
   )`,

  `CREATE TABLE IF NOT EXISTS payouts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     commission_id INTEGER NOT NULL,
     user_id INTEGER,
     party TEXT NOT NULL,                        -- painter | photographer | platform
     amount_cents INTEGER NOT NULL,
     state TEXT NOT NULL DEFAULT 'pending',      -- pending | paid | failed | reversed
     transfer_ref TEXT,
     failure_reason TEXT,
     created_at TEXT DEFAULT (datetime('now')),
     paid_at TEXT,
     FOREIGN KEY (commission_id) REFERENCES commissions(id) ON DELETE CASCADE
   )`,

  `CREATE TABLE IF NOT EXISTS artworks (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     commission_id INTEGER,
     license_id INTEGER,
     painter_id INTEGER NOT NULL,
     photographer_id INTEGER NOT NULL,
     title TEXT NOT NULL,
     medium TEXT, size TEXT,
     images TEXT DEFAULT '[]',                   -- JSON array of file paths
     completed_at TEXT DEFAULT (datetime('now')),
     FOREIGN KEY (commission_id) REFERENCES commissions(id) ON DELETE SET NULL
   )`,

  `CREATE TABLE IF NOT EXISTS registry_entries (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     public_id TEXT UNIQUE NOT NULL,             -- the certificate number people quote
     artwork_id INTEGER NOT NULL,
     kind TEXT NOT NULL DEFAULT 'creation',      -- creation | resale
     previous_entry_hash TEXT,                   -- provenance chain
     canonical TEXT NOT NULL,                    -- canonical JSON that was signed
     content_hash TEXT NOT NULL,
     signature TEXT NOT NULL,                    -- Ed25519 over content_hash, base64
     key_id TEXT NOT NULL,
     created_at TEXT DEFAULT (datetime('now')),
     FOREIGN KEY (artwork_id) REFERENCES artworks(id) ON DELETE CASCADE
   )`,

  `CREATE TABLE IF NOT EXISTS downloads (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     license_id INTEGER NOT NULL,
     user_id INTEGER NOT NULL,
     watermark_id TEXT NOT NULL,                 -- unique per download, not per licence
     ip TEXT, user_agent TEXT,
     bytes INTEGER,
     created_at TEXT DEFAULT (datetime('now')),
     FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE CASCADE
   )`,

  `CREATE TABLE IF NOT EXISTS tax_documents (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id INTEGER NOT NULL,
     tax_year INTEGER NOT NULL,
     form_type TEXT NOT NULL DEFAULT '1099-NEC',
     gross_cents INTEGER NOT NULL,
     payout_count INTEGER NOT NULL,
     threshold_cents INTEGER NOT NULL,
     reportable INTEGER NOT NULL,
     pdf_file TEXT,
     generated_at TEXT DEFAULT (datetime('now')),
     UNIQUE(user_id, tax_year, form_type),
     FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
   )`,

  'CREATE INDEX IF NOT EXISTS idx_photos_owner   ON photos(photographer_id)',
  'CREATE INDEX IF NOT EXISTS idx_photos_status  ON photos(status)',
  'CREATE INDEX IF NOT EXISTS idx_skus_photo     ON photo_skus(photo_id)',
  'CREATE INDEX IF NOT EXISTS idx_comm_buyer     ON commissions(buyer_id)',
  'CREATE INDEX IF NOT EXISTS idx_comm_painter   ON commissions(painter_id)',
  'CREATE INDEX IF NOT EXISTS idx_comm_photog    ON commissions(photographer_id)',
  'CREATE INDEX IF NOT EXISTS idx_comm_state     ON commissions(state)',
  'CREATE INDEX IF NOT EXISTS idx_lic_licensee   ON licenses(licensee_id)',
  'CREATE INDEX IF NOT EXISTS idx_payouts_user   ON payouts(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_dl_watermark   ON downloads(watermark_id)',
];

function apply(sqliteDb) {
  sqliteDb.run('PRAGMA foreign_keys = ON');
  for (const stmt of STATEMENTS) sqliteDb.run(stmt);
}

module.exports = { apply, SKUS };
