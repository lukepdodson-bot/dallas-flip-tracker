/**
 * Scraper orchestrator — runs all scrapers, upserts results, geocodes new entries.
 */
require('dotenv').config();
const db = require('../db/database');
const { scrapeHUDHomes }               = require('./hudHomes');
const { scrapeDallasCountyForeclosures } = require('./dallasCountyClerk');
const { scrapeAuctionDotCom }          = require('./auctionDotCom');
const { geocodeUngeocodedProperties }  = require('./geocoder');

// NOTE: uses :param syntax (not @param) — matches the sql.js wrapper's bindParams()
const upsertProperty = db.prepare(`
  INSERT INTO properties (
    address, city, state, zip_code, county, lat, lng,
    price, estimated_value, bedrooms, bathrooms, sqft, lot_size_sqft, year_built,
    property_type, sale_type, status, auction_date, list_date,
    source, source_id, source_url, description, case_number, trustee, lender, images
  ) VALUES (
    :address, :city, 'TX', :zip_code, :county, :lat, :lng,
    :price, :estimated_value, :bedrooms, :bathrooms, :sqft, :lot_size_sqft, :year_built,
    :property_type, :sale_type, :status, :auction_date, :list_date,
    :source, :source_id, :source_url, :description, :case_number, :trustee, :lender, '[]'
  )
  ON CONFLICT(source, source_id) DO UPDATE SET
    price           = COALESCE(excluded.price, price),
    status          = COALESCE(excluded.status, status),
    auction_date    = COALESCE(excluded.auction_date, auction_date),
    bedrooms        = COALESCE(excluded.bedrooms, bedrooms),
    bathrooms       = COALESCE(excluded.bathrooms, bathrooms),
    sqft            = COALESCE(excluded.sqft, sqft),
    source_url      = COALESCE(excluded.source_url, source_url),
    description     = COALESCE(excluded.description, description),
    updated_at      = datetime('now')
`);

async function runAllScrapers() {
  const scrapers = [
    { name: 'HUD Homes',          fn: scrapeHUDHomes },
    { name: 'Dallas County',      fn: scrapeDallasCountyForeclosures },
    { name: 'Auction.com',        fn: scrapeAuctionDotCom },
  ];

  let totalAdded = 0, totalUpdated = 0;

  for (const scraper of scrapers) {
    const logRow = db.prepare(
      `INSERT INTO scrape_log (source, status) VALUES (?, ?)`
    ).run(scraper.name, 'running');
    const logId = logRow.lastInsertRowid;

    let results = [], error = null;
    try {
      console.log(`\n── Running scraper: ${scraper.name} ──`);
      results = await scraper.fn();
    } catch (e) {
      error = e.message;
      console.error(`[${scraper.name}] Fatal:`, e.message);
    }

    let added = 0, updated = 0;
    for (const prop of results) {
      if (!prop.address || !prop.source_id) continue;
      try {
        const exists = db.prepare(
          `SELECT id FROM properties WHERE source=? AND source_id=?`
        ).get(prop.source, prop.source_id);

        upsertProperty.run({
          address:        prop.address        || '',
          city:           prop.city           || 'Dallas',
          zip_code:       prop.zip_code       || null,
          county:         prop.county         || 'Dallas',
          lat:            prop.lat            || null,
          lng:            prop.lng            || null,
          price:          prop.price          || null,
          estimated_value:prop.estimated_value|| null,
          bedrooms:       prop.bedrooms       || null,
          bathrooms:      prop.bathrooms      || null,
          sqft:           prop.sqft           || null,
          lot_size_sqft:  prop.lot_size_sqft  || null,
          year_built:     prop.year_built     || null,
          property_type:  prop.property_type  || 'SFR',
          sale_type:      prop.sale_type      || 'Foreclosure',
          status:         prop.status         || 'Active',
          auction_date:   prop.auction_date   || null,
          list_date:      prop.list_date      || new Date().toISOString().split('T')[0],
          source:         prop.source,
          source_id:      String(prop.source_id),
          source_url:     prop.source_url     || null,
          description:    prop.description    || null,
          case_number:    prop.case_number    || null,
          trustee:        prop.trustee        || null,
          lender:         prop.lender         || null,
        });

        if (exists) updated++; else added++;
      } catch (e) {
        console.error(`  Skip (${prop.address}): ${e.message}`);
      }
    }

    totalAdded   += added;
    totalUpdated += updated;

    db.prepare(`
      UPDATE scrape_log SET
        status=?, records_found=?, records_added=?, records_updated=?,
        error_message=?, finished_at=datetime('now')
      WHERE id=?
    `).run(error ? 'error' : 'success', results.length, added, updated, error || null, logId);

    console.log(`[${scraper.name}] ${results.length} found → ${added} added, ${updated} updated`);
  }

  console.log(`\nTotal: ${totalAdded} added, ${totalUpdated} updated`);

  console.log('\nGeocoding new properties…');
  await geocodeUngeocodedProperties(db);
  console.log('Scrape complete.');
}

if (require.main === module) {
  const { initDB } = require('../db/database');
  initDB().then(runAllScrapers).catch(console.error);
}

module.exports = { runAllScrapers };
