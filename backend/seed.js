/**
 * Seed — creates user accounts only.
 * Property data comes exclusively from the scrapers (no demo data).
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db/database');

console.log('Running seed…');

// Rename legacy 'buddy' → 'john' if it exists
try {
  const row = db.prepare(`SELECT id FROM users WHERE username='buddy'`).get();
  if (row) {
    db.prepare(`UPDATE users SET username='john', email='john@example.com' WHERE username='buddy'`).run();
    console.log('Renamed user "buddy" → "john"');
  }
} catch {}

// Remove all demo/seed properties (source_id starts with DC-2026, HUD-2026, etc.)
// Only runs once — real scraper data has different source_id patterns
try {
  const deleted = db.prepare(`
    DELETE FROM properties
    WHERE source_id LIKE 'DC-2026-%'
       OR source_id LIKE 'HUD-2026-%'
       OR source_id LIKE 'TAX-2026-%'
       OR source_id LIKE 'SS-2026-%'
       OR source_id LIKE 'FN-2026-%'
  `).run();
  if (deleted.changes > 0) console.log(`Removed ${deleted.changes} demo properties`);
} catch {}

const users = [
  { username: 'luke', email: 'luke@example.com', password: 'FlipDallas2024!', role: 'admin' },
  { username: 'john', email: 'john@example.com', password: 'FlipDallas2024!', role: 'user'  },
];

for (const u of users) {
  const hash = bcrypt.hashSync(u.password, 10);
  try {
    db.prepare(`
      INSERT INTO users (username, email, password_hash, role)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET email=excluded.email, role=excluded.role
    `).run(u.username, u.email, hash, u.role);
    console.log(`User "${u.username}" ready`);
  } catch (e) {
    console.error(`User "${u.username}" error:`, e.message);
  }
}

console.log('Seed done.');
