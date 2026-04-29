/**
 * SQLite database using Node.js built-in node:sqlite (available since Node 22.5, no compilation needed).
 *
 * Compatibility shim: the rest of the app was written against better-sqlite3's API where
 * named parameters are passed as plain objects without a prefix (e.g. {address: 'foo'}).
 * node:sqlite requires the prefix character in the key (e.g. {'@address': 'foo'}).
 * The shim transparently handles that conversion.
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

// On Railway, use the mounted volume at /data. Locally, use backend/data/
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? process.env.RAILWAY_VOLUME_MOUNT_PATH
  : path.join(__dirname, '..', 'data');

const DB_PATH = path.join(DATA_DIR, 'foreclosures.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const rawDb = new DatabaseSync(DB_PATH);

rawDb.exec('PRAGMA journal_mode = WAL');
rawDb.exec('PRAGMA foreign_keys = ON');

rawDb.exec(`
  CREATE TABLE IF NOT EXISTS properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT NOT NULL,
    city TEXT DEFAULT 'Dallas',
    state TEXT DEFAULT 'TX',
    zip_code TEXT,
    county TEXT DEFAULT 'Dallas',
    lat REAL,
    lng REAL,
    price REAL,
    estimated_value REAL,
    bedrooms INTEGER,
    bathrooms REAL,
    sqft INTEGER,
    lot_size_sqft INTEGER,
    year_built INTEGER,
    property_type TEXT,
    sale_type TEXT,
    status TEXT DEFAULT 'Active',
    auction_date TEXT,
    list_date TEXT,
    source TEXT,
    source_url TEXT,
    source_id TEXT,
    description TEXT,
    images TEXT DEFAULT '[]',
    case_number TEXT,
    trustee TEXT,
    lender TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(source, source_id)
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS saved_properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    property_id INTEGER NOT NULL,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
    UNIQUE(user_id, property_id)
  );

  CREATE TABLE IF NOT EXISTS scrape_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    records_found INTEGER DEFAULT 0,
    records_added INTEGER DEFAULT 0,
    records_updated INTEGER DEFAULT 0,
    error_message TEXT,
    started_at TEXT DEFAULT (datetime('now')),
    finished_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_properties_zip ON properties(zip_code);
  CREATE INDEX IF NOT EXISTS idx_properties_sale_type ON properties(sale_type);
  CREATE INDEX IF NOT EXISTS idx_properties_price ON properties(price);
  CREATE INDEX IF NOT EXISTS idx_properties_auction_date ON properties(auction_date);
  CREATE INDEX IF NOT EXISTS idx_properties_status ON properties(status);
  CREATE INDEX IF NOT EXISTS idx_properties_list_date ON properties(list_date);
`);

// Prefix plain-object keys with '@' for node:sqlite named param syntax
function prefixKeys(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = (k[0] === '@' || k[0] === ':' || k[0] === '$') ? k : `@${k}`;
    out[key] = v;
  }
  return out;
}

// Normalise args to what node:sqlite expects
function normaliseArgs(args) {
  if (args.length === 0) return [];
  if (
    args.length === 1 &&
    typeof args[0] === 'object' &&
    args[0] !== null &&
    !Array.isArray(args[0])
  ) {
    return [prefixKeys(args[0])];
  }
  // Positional scalars (spread from array or multiple primitive args)
  return args;
}

// Wrap a StatementSync so callers can use the better-sqlite3 interface
function wrap(stmt) {
  return {
    run(...args) {
      const result = stmt.run(...normaliseArgs(args));
      // result = { changes, lastInsertRowid } — expose lastInsertRowid directly too
      result.changes = result.changes ?? 0;
      return result;
    },
    get(...args) {
      return stmt.get(...normaliseArgs(args)) ?? null;
    },
    all(...args) {
      return stmt.all(...normaliseArgs(args));
    },
  };
}

// Public db object
const db = {
  prepare(sql) {
    return wrap(rawDb.prepare(sql));
  },
  exec(sql) {
    return rawDb.exec(sql);
  },
};

module.exports = db;
