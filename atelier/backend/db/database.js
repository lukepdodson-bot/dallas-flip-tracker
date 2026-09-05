/**
 * SQLite via sql.js (pure WebAssembly - no native compilation, any Node version).
 * Same better-sqlite3-shaped API as the tracker backend, plus tx() for batching
 * writes: sql.js has no incremental persistence, so every run() rewrites the whole
 * file. Commission creation touches half a dozen tables, so batching matters.
 *
 * Call initDB() once at startup, then use db.prepare() normally.
 */
const path = require('path');
const fs   = require('fs');

const DATA_DIR = process.env.ATELIER_DATA_DIR
  || process.env.RAILWAY_VOLUME_MOUNT_PATH
  || path.join(__dirname, '..', 'data');

const DB_PATH = path.join(DATA_DIR, 'atelier.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let sqliteDb    = null;  // sql.js Database instance
let persistDepth = 0;    // >0 while inside tx(); suppresses intermediate writes
let persistDirty = false;

function persist() {
  if (persistDepth > 0) { persistDirty = true; return; }
  fs.writeFileSync(DB_PATH, Buffer.from(sqliteDb.export()));
}

// ── Named-param shim: {photoId:1} -> {':photoId':1} ──────────────────────────
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

function normaliseArgs(args) {
  if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])) {
    return args[0];
  }
  return args.length ? args : null;
}

function wrap(sql) {
  return {
    run(...args) {
      const bound = bindParams(normaliseArgs(args));
      const stmt  = sqliteDb.prepare(sql);
      stmt.bind(bound || []);
      stmt.step();
      stmt.free();
      const lastId  = sqliteDb.exec('SELECT last_insert_rowid()')[0]?.values[0][0] ?? null;
      const changes = sqliteDb.exec('SELECT changes()')[0]?.values[0][0] ?? 0;
      persist();
      return { lastInsertRowid: lastId, changes };
    },
    get(...args) {
      const bound = bindParams(normaliseArgs(args));
      const stmt  = sqliteDb.prepare(sql);
      stmt.bind(bound || []);
      const row = stmt.step() ? stmt.getAsObject() : null;
      stmt.free();
      return row;
    },
    all(...args) {
      const bound = bindParams(normaliseArgs(args));
      const stmt  = sqliteDb.prepare(sql);
      stmt.bind(bound || []);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    },
  };
}

const db = {
  prepare(sql) { return wrap(sql); },
  exec(sql)    { sqliteDb.run(sql); persist(); },

  /**
   * Run fn inside a SQL transaction, persisting to disk once at the end.
   * Rolls back and rethrows if fn throws. Not reentrant-safe across async
   * boundaries - fn must be synchronous, which every caller here is.
   */
  tx(fn) {
    if (persistDepth > 0) return fn();     // already inside one - just run it
    sqliteDb.run('BEGIN');
    persistDepth++;
    try {
      const result = fn();
      sqliteDb.run('COMMIT');
      persistDepth--;
      if (persistDirty) { persistDirty = false; persist(); }
      return result;
    } catch (err) {
      sqliteDb.run('ROLLBACK');
      persistDepth--;
      persistDirty = false;
      throw err;
    }
  },
};

async function initDB() {
  if (sqliteDb) return db;

  const initSqlJs = require('sql.js');
  const wasmPath  = require.resolve('sql.js/dist/sql-wasm.wasm');
  const SQL = await initSqlJs({ locateFile: () => wasmPath });

  sqliteDb = fs.existsSync(DB_PATH)
    ? new SQL.Database(fs.readFileSync(DB_PATH))
    : new SQL.Database();

  require('./schema').apply(sqliteDb);
  persist();
  return db;
}

module.exports = db;
module.exports.initDB  = initDB;
module.exports.DATA_DIR = DATA_DIR;
module.exports.DB_PATH  = DB_PATH;
