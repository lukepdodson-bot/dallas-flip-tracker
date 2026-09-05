/**
 * Idempotent seed: licence templates always, demo data only into an empty
 * database. Safe to call on every boot.
 */
const zlib   = require('zlib');
const bcrypt = require('bcryptjs');
const db     = require('./db/database');
const files  = require('./services/files');
const { TEMPLATES } = require('./services/licenseTemplates');
const { SKUS }      = require('./db/schema');

const DEMO_PASSWORD = 'AtelierDemo2026!';

// ── A tiny PNG encoder, so the demo library has real, viewable files ─────────
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])), 8 + data.length);
  return out;
}

/**
 * A soft two-tone gradient with a horizon, which is enough to read as a value
 * study - the point of the library is images with a clear value structure.
 */
function makePng(width, height, [r1, g1, b1], [r2, g2, b2], horizon = 0.62) {
  const raw = Buffer.alloc(height * (width * 3 + 1));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0;                                   // filter: none
    const v = y / height;
    const sky = v < horizon;
    const t = sky ? v / horizon : (v - horizon) / (1 - horizon);
    for (let x = 0; x < width; x++) {
      const wobble = Math.sin((x / width) * Math.PI * 3 + y * 0.01) * 12;
      const mix = sky ? t * 0.7 : 0.7 + t * 0.3;
      raw[offset++] = clamp(r1 + (r2 - r1) * mix + wobble);
      raw[offset++] = clamp(g1 + (g2 - g1) * mix + wobble * 0.6);
      raw[offset++] = clamp(b1 + (b2 - b1) * mix + wobble * 0.3);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;                              // 8-bit, truecolour

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const clamp = n => Math.max(0, Math.min(255, Math.round(n)));

// ── Seeding ──────────────────────────────────────────────────────────────────

function seedTemplates() {
  for (const template of Object.values(TEMPLATES)) {
    db.prepare(`
      INSERT INTO license_templates (tier, version, title, body, active) VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(tier, version) DO UPDATE SET title = excluded.title, body = excluded.body
    `).run(template.tier, template.version, template.title,
           template.clauses.map(([h, b], i) => `${i + 1}. ${h}. ${b}`).join('\n\n'));
  }
}

function createUser({ email, name, roles, legalName, payouts = true }) {
  const result = db.prepare(`
    INSERT INTO users (email, name, password_hash, roles, legal_name, stripe_account_id, payouts_enabled, tax_id_last4)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(email, name, bcrypt.hashSync(DEMO_PASSWORD, 10), roles.join(','), legalName,
         payouts ? `acct_demo_${email.split('@')[0]}` : null, payouts ? 1 : 0, payouts ? '4321' : null);
  return result.lastInsertRowid;
}

const DEMO_PHOTOS = [
  { title: 'Long light, Caddo flats',       tags: ['landscape', 'water', 'golden hour'], palette: [[214, 198, 160], [58, 74, 68]],  floor: 15000, forPainting: true },
  { title: 'Harbour wall, low tide',        tags: ['coast', 'architecture', 'grey'],     palette: [[186, 196, 204], [46, 58, 70]],  floor: 12000, forPainting: true },
  { title: 'Cottonwoods before the storm',  tags: ['landscape', 'trees', 'weather'],     palette: [[176, 178, 158], [40, 44, 52]],  floor: 20000, forPainting: true },
  { title: 'Second Avenue, rain',           tags: ['street', 'city', 'reflection'],      palette: [[128, 134, 150], [28, 30, 40]],  floor: 9000,  forPainting: false },
  { title: 'Marguerite, north window',      tags: ['portrait', 'interior', 'soft light'],palette: [[224, 206, 190], [72, 60, 58]],  floor: 30000, forPainting: true },
  { title: 'Winter field, four crows',      tags: ['landscape', 'minimal', 'snow'],      palette: [[230, 232, 234], [96, 100, 104]],floor: 11000, forPainting: false },
];

function seedDemo() {
  const photographerId = createUser({ email: 'ada@example.com',    name: 'Ada Okonkwo',    roles: ['photographer'],        legalName: 'Adaeze Okonkwo' });
  const marcusId       = createUser({ email: 'marcus@example.com', name: 'Marcus Reyes',   roles: ['painter'],             legalName: 'Marcus A. Reyes' });
  const lenaId         = createUser({ email: 'lena@example.com',   name: 'Lena Hartmann',  roles: ['painter'],             legalName: 'Lena Hartmann' });
  const buyerId        = createUser({ email: 'sam@example.com',    name: 'Sam Whitfield',  roles: ['buyer'],               legalName: 'Samuel Whitfield', payouts: false });
                         createUser({ email: 'admin@example.com',  name: 'Platform Admin', roles: ['admin', 'buyer'],      legalName: 'Platform Admin',   payouts: false });

  db.prepare(`
    INSERT INTO painter_profiles (user_id, bio, mediums, min_price_cents, max_price_cents, turnaround_days, accepting, location)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `).run(marcusId,
    'Oil on linen, alla prima where the light allows. Twenty years of plein air behind the studio work. ' +
    'I work from a single good reference rather than a composite, which is why I am here.',
    JSON.stringify(['oil', 'oil on linen']), 80000, 600000, 45, 'Santa Fe, NM');

  db.prepare(`
    INSERT INTO painter_profiles (user_id, bio, mediums, min_price_cents, max_price_cents, turnaround_days, accepting, location)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `).run(lenaId,
    'Watercolour and gouache, small to medium. Fast turnarounds and a light hand. I like weather, ' +
    'water and anything with a clear value structure to build on.',
    JSON.stringify(['watercolour', 'gouache']), 25000, 180000, 21, 'Portland, OR');

  DEMO_PHOTOS.forEach((spec, index) => {
    const licensed = makePng(1400, 950, spec.palette[0], spec.palette[1]);
    const display  = makePng(900, 610,  spec.palette[0], spec.palette[1]);
    const thumb    = makePng(420, 285,  spec.palette[0], spec.palette[1]);

    const licensedPath = files.save('photos', `${photographerId}/seed-licensed-${index}.png`, licensed);
    const displayPath  = files.save('photos', `${photographerId}/seed-display-${index}.png`,  display);
    const thumbPath    = files.save('photos', `${photographerId}/seed-thumb-${index}.png`,    thumb);

    const photoId = db.prepare(`
      INSERT INTO photos (photographer_id, title, description, tags, orientation, width, height,
                          licensed_file, display_file, thumb_file, licensed_sha256, shot_for_painting, status)
      VALUES (?, ?, ?, ?, 'landscape', 1400, 950, ?, ?, ?, ?, ?, 'published')
    `).run(photographerId, spec.title,
           spec.forPainting
             ? 'Shot for painting: even light, readable value structure, and a wide crop with room to recompose.'
             : 'Available as a commission reference.',
           JSON.stringify(spec.tags), licensedPath, displayPath, thumbPath,
           files.sha256File(licensedPath), spec.forPainting ? 1 : 0).lastInsertRowid;

    for (const sku of SKUS) {
      db.prepare('INSERT INTO photo_skus (photo_id, sku, enabled, floor_price_cents) VALUES (?, ?, ?, ?)')
        .run(photoId, sku, sku === 'commission' ? 1 : 0, sku === 'commission' ? spec.floor : 0);
    }
  });

  console.log(`Seeded ${DEMO_PHOTOS.length} images, 2 painters, 1 photographer, 1 buyer, 1 admin.`);
  console.log(`Demo sign-in: ada@example.com / marcus@example.com / sam@example.com  -  ${DEMO_PASSWORD}`);
  return { photographerId, marcusId, lenaId, buyerId };
}

function seed() {
  return db.tx(() => {
    seedTemplates();
    const existing = db.prepare('SELECT COUNT(*) AS count FROM users').get();
    if (existing.count > 0) return null;
    return seedDemo();
  });
}

if (require.main === module) {
  require('./db/database').initDB().then(() => { seed(); console.log('Seed complete.'); });
}

module.exports = { seed, seedDemo, seedTemplates, makePng, DEMO_PASSWORD };
