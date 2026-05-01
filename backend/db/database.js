/**
 * SQLite via sql.js (pure WebAssembly — no native compilation, any Node version).
 * Uses async init; call initDB() once at startup, then use db.prepare() normally.
 */
const path = require('path');
const fs   = require('fs');

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? process.env.RAILWAY_VOLUME_MOUNT_PATH
  : path.join(__dirname, '..', 'data');

const DB_PATH = path.join(DATA_DIR, 'foreclosures.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let sqliteDb = null; // sql.js Database instance

// ── Persist to disk after every write ────────────────────────────────────────
function persist() {
  const data = sqliteDb.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// ── Named-param shim: {address:'x'} → {':address':'x'} ───────────────────────
function bindParams(params) {
  if (!params) return undefined;
  if (Array.isArray(params)) return params.length ? params : undefined;
  if (typeof params !== 'object') return [params];

  const keys = Object.keys(params);
  if (!keys.length) return undefined;

  const out = {};
  for (const [k, v] of Object.entries(params)) {
    const key = /^[:@$]/.test(k) ? k : `:${k}`;
    out[key] = v ?? null;
  }
  return out;
}

// ── Wrap sql.js into a better-sqlite3-style API ───────────────────────────────
function wrap(sql) {
  return {
    run(...args) {
      const raw = args.length === 1 && typeof args[0] === 'object' && !Array.isArray(args[0])
        ? args[0] : (args.length ? args : null);
      const bound = bindParams(raw);
      const stmt = sqliteDb.prepare(sql);
      bound ? stmt.bind(bound) : stmt.bind([]);
      stmt.step();
      stmt.free();
      const lastId  = sqliteDb.exec('SELECT last_insert_rowid()')[0]?.values[0][0] ?? null;
      const changes = sqliteDb.exec('SELECT changes()')[0]?.values[0][0] ?? 0;
      persist();
      return { lastInsertRowid: lastId, changes };
    },
    get(...args) {
      const raw = args.length === 1 && typeof args[0] === 'object' && !Array.isArray(args[0])
        ? args[0] : (args.length ? args : null);
      const bound = bindParams(raw);
      const stmt  = sqliteDb.prepare(sql);
      bound ? stmt.bind(bound) : stmt.bind([]);
      const row = stmt.step() ? stmt.getAsObject() : null;
      stmt.free();
      return row;
    },
    all(...args) {
      const raw = args.length === 1 && typeof args[0] === 'object' && !Array.isArray(args[0])
        ? args[0] : (args.length ? args : null);
      const bound = bindParams(raw);
      const stmt  = sqliteDb.prepare(sql);
      bound ? stmt.bind(bound) : stmt.bind([]);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    },
  };
}

// ── Public db proxy ───────────────────────────────────────────────────────────
const db = {
  prepare(sql) { return wrap(sql); },
  exec(sql)    { sqliteDb.run(sql); },
};

// ── Async init (call once at server startup) ──────────────────────────────────
async function initDB() {
  if (sqliteDb) return db; // already ready

  const initSqlJs = require('sql.js');
  const wasmPath  = require.resolve('sql.js/dist/sql-wasm.wasm');
  const SQL = await initSqlJs({ locateFile: () => wasmPath });

  sqliteDb = fs.existsSync(DB_PATH)
    ? new SQL.Database(fs.readFileSync(DB_PATH))
    : new SQL.Database();

  // Schema
  sqliteDb.run('PRAGMA foreign_keys = ON');
  sqliteDb.run(`CREATE TABLE IF NOT EXISTS properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT NOT NULL, city TEXT DEFAULT 'Dallas', state TEXT DEFAULT 'TX',
    zip_code TEXT, county TEXT DEFAULT 'Dallas', lat REAL, lng REAL,
    price REAL, estimated_value REAL, bedrooms INTEGER, bathrooms REAL,
    sqft INTEGER, lot_size_sqft INTEGER, year_built INTEGER,
    property_type TEXT, sale_type TEXT, status TEXT DEFAULT 'Active',
    auction_date TEXT, list_date TEXT, source TEXT, source_url TEXT,
    source_id TEXT, description TEXT, images TEXT DEFAULT '[]',
    case_number TEXT, trustee TEXT, lender TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(source, source_id)
  )`);
  sqliteDb.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE, password_hash TEXT NOT NULL, role TEXT DEFAULT 'user',
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  sqliteDb.run(`CREATE TABLE IF NOT EXISTS saved_properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    property_id INTEGER NOT NULL, notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
    UNIQUE(user_id, property_id)
  )`);
  sqliteDb.run(`CREATE TABLE IF NOT EXISTS scrape_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL,
    status TEXT NOT NULL, records_found INTEGER DEFAULT 0,
    records_added INTEGER DEFAULT 0, records_updated INTEGER DEFAULT 0,
    error_message TEXT, started_at TEXT DEFAULT (datetime('now')), finished_at TEXT
  )`);
  [
    'CREATE INDEX IF NOT EXISTS idx_p_zip  ON properties(zip_code)',
    'CREATE INDEX IF NOT EXISTS idx_p_type ON properties(sale_type)',
    'CREATE INDEX IF NOT EXISTS idx_p_px   ON properties(price)',
    'CREATE INDEX IF NOT EXISTS idx_p_auc  ON properties(auction_date)',
    'CREATE INDEX IF NOT EXISTS idx_p_st   ON properties(status)',
    'CREATE INDEX IF NOT EXISTS idx_p_ld   ON properties(list_date)',
  ].forEach(s => sqliteDb.run(s));

  // ── Migrations: add owner columns to existing tables (idempotent) ───────────
  const ownerCols = [
    ['owner_name',             'TEXT'],
    ['owner_mailing_address',  'TEXT'],
    ['owner_phone',            'TEXT'],
    ['owner_email',            'TEXT'],
    ['owner_lookup_attempted', 'TEXT'],   // ISO date of last lookup attempt
  ];
  for (const [col, type] of ownerCols) {
    try { sqliteDb.run(`ALTER TABLE properties ADD COLUMN ${col} ${type}`); }
    catch { /* column already exists */ }
  }

  persist();
  return db;
}

module.exports = db;
module.exports.initDB = initDB;
