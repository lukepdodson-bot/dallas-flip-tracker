/**
 * Dallas County Foreclosure Scraper
 *
 * Sources for Dallas County distressed / foreclosure properties:
 *
 * 1. Bid4Assets — Dallas County tax deed sales
 *    https://www.bid4assets.com/auctions#/taxsales?countyId=12&stateId=TX
 *
 * 2. BDFTE / Barrett Daffin trustee sale notices via logs.com
 *    https://www.logs.com/texas/ (Dallas county section)
 *
 * 3. Dallas County District Clerk monthly foreclosure notice list
 *    https://www.dallascounty.org/departments/countyclerk/foreclosure.php
 *
 * Browser rendering used for all three (React/JS-heavy sites).
 */
const cheerio = require('cheerio');
const { launchBrowser, newPage } = require('./browser');

// Next first Tuesdays (Texas foreclosure auction days)
function nextFirstTuesdays(count = 4) {
  const out = [];
  const now = new Date();
  let [yr, mo] = [now.getFullYear(), now.getMonth()];
  while (out.length < count + 2) {
    const d = new Date(yr, mo, 1);
    while (d.getDay() !== 2) d.setDate(d.getDate() + 1);
    if (d > now) out.push(d.toISOString().split('T')[0]);
    if (++mo > 11) { mo = 0; yr++; }
    if (out.length >= count) break;
  }
  return out;
}

const DALLAS_CITIES = [
  'Dallas','Irving','Garland','Mesquite','DeSoto','Lancaster','Rowlett',
  'Grand Prairie','Duncanville','Balch Springs','Hutchins','Wilmer',
  'Seagoville','Sunnyvale','Sachse','Farmers Branch','Richardson',
  'Carrollton','Cedar Hill','Glenn Heights','Cockrell Hill',
];

async function scrapeDallasCountyForeclosures() {
  const results = [];
  const upcomingTuesday = nextFirstTuesdays(1)[0];
  let browser;

  try {
    browser = await launchBrowser();

    // ── Source 1: Bid4Assets tax sales ───────────────────────────────────────
    try {
      const page = await newPage(browser);
      console.log('[Bid4Assets] Navigating...');

      // Try the tax sales search with Dallas County TX filter
      await page.goto('https://www.bid4assets.com/txdallas', {
        waitUntil: 'networkidle2',
        timeout: 60000,
      });
      await page.humanDelay();

      const title = await page.title();
      console.log(`[Bid4Assets] Title: "${title}"`);

      const html = await page.content();
      const $    = cheerio.load(html);

      // Bid4Assets uses various card/item structures
      const selectors = [
        '.auction-item',
        '[class*="auction-item"]',
        '[class*="property-item"]',
        '[class*="listing-item"]',
        '.property-card',
        'article[class*="auction"]',
        '[data-id]',
        '.results-list li',
      ];

      let cards = $([]);
      for (const sel of selectors) {
        const found = $(sel);
        if (found.length > 0) {
          cards = found;
          console.log(`[Bid4Assets] Using selector "${sel}": ${found.length} items`);
          break;
        }
      }

      cards.each((_, card) => {
        const text    = $(card).text().trim();
        const address = $(card).find('[class*="address" i], [class*="street" i], h2, h3, .title').first().text().trim();
        if (!address || address.length < 5) return;
        if (!text.toLowerCase().includes('dallas') && !isDallasCity(address)) return;

        const priceEl  = $(card).find('[class*="price" i], [class*="bid" i], [class*="amount" i]').first().text();
        const price    = parseFloat(priceEl.replace(/[^0-9.]/g, '')) || null;
        const href     = $(card).find('a').first().attr('href');
        const dataId   = $(card).attr('data-id') || $(card).attr('id') || '';

        results.push({
          address:      address.replace(/,?\s*(TX|Texas|\d{5}).*/i, '').trim(),
          city:         extractCity(text) || extractCity(address) || 'Dallas',
          county:       'Dallas',
          price,
          property_type: 'SFR',
          sale_type:    'Tax Sale',
          status:       'Active',
          auction_date: upcomingTuesday,
          list_date:    new Date().toISOString().split('T')[0],
          source:       'Dallas County Tax Sale',
          source_id:    `BID4-${dataId || address.replace(/\W+/g, '-').substring(0, 60)}`,
          source_url:   href
            ? (href.startsWith('http') ? href : `https://www.bid4assets.com${href}`)
            : 'https://www.bid4assets.com/txdallas',
          description:  'Dallas County tax deed sale via Bid4Assets. Buyer responsible for any remaining liens. Online bidding.',
        });
      });

      console.log(`[Bid4Assets] Found ${results.length} properties`);
      await page.close();
    } catch (e) {
      console.error('[Bid4Assets] Error:', e.message);
    }

    // ── Source 2: LOGS.com Texas foreclosure notices ──────────────────────────
    try {
      const page = await newPage(browser);
      const logsUrls = [
        'https://www.logs.com/texas/dallas/',
        'https://www.logs.com/texas/',
      ];

      let html = null;
      let usedUrl = '';
      for (const url of logsUrls) {
        try {
          console.log(`[LOGS.com] Trying ${url}...`);
          await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
          const pg = await page.content();
          if (!pg.includes('404') && pg.length > 10000) {
            html = pg;
            usedUrl = url;
            break;
          }
        } catch {}
      }

      if (html) {
        console.log(`[LOGS.com] Loaded: ${usedUrl}`);
        const $ = cheerio.load(html);
        const prevLen = results.length;

        // Parse table rows typical of legal notice sites
        $('table tr').each((i, row) => {
          if (i === 0) return;
          const cells = $(row).find('td');
          const text  = $(row).text();
          if (!text.toLowerCase().includes('dallas')) return;
          if (cells.length < 2) return;

          const caseNum  = $(cells[0]).text().trim();
          const address  = $(cells[1]).text().trim() || $(cells[0]).find('a').text().trim();
          if (!address || address.length < 5) return;

          const href = $(row).find('a').first().attr('href');
          results.push({
            address:      address.replace(/,?\s*(TX|Texas|\d{5}).*/i, '').trim(),
            city:         extractCity(text) || 'Dallas',
            county:       'Dallas',
            property_type: 'SFR',
            sale_type:    'Foreclosure',
            status:       'Active',
            auction_date: upcomingTuesday,
            list_date:    new Date().toISOString().split('T')[0],
            source:       'Dallas County Clerk',
            source_id:    caseNum || `LOGS-${address.replace(/\W+/g, '-').substring(0, 60)}`,
            source_url:   href
              ? (href.startsWith('http') ? href : `https://www.logs.com${href}`)
              : usedUrl,
            case_number:  caseNum || null,
            description:  'Notice of Trustee Sale — Dallas County. Auction at Dallas County Courthouse, 600 Commerce St. Cash only.',
          });
        });

        console.log(`[LOGS.com] Found ${results.length - prevLen} properties`);
      } else {
        console.log('[LOGS.com] No usable page found');
      }
      await page.close();
    } catch (e) {
      console.error('[LOGS.com] Error:', e.message);
    }

    // ── Source 3: Dallas County Foreclosure notices (dallascounty.org) ────────
    try {
      const page = await newPage(browser);
      console.log('[Dallas Co Clerk] Navigating...');
      await page.goto('https://www.dallascounty.org/departments/countyclerk/foreclosure.php', {
        waitUntil: 'networkidle2',
        timeout: 45000,
      });
      await page.humanDelay();

      const title = await page.title();
      console.log(`[Dallas Co Clerk] Title: "${title}"`);

      const html = await page.content();
      if (!html.includes('404')) {
        const $ = cheerio.load(html);
        const prevLen = results.length;

        // Look for PDF/document links for foreclosure lists
        $('a[href*=".pdf"], a[href*="foreclosure"], a[href*="notice"]').each((_, link) => {
          const text = $(link).text().trim();
          if (!text) return;
          const href = $(link).attr('href');
          // These are document links, not individual properties
          // Just log them for now
          console.log(`[Dallas Co Clerk] Doc link: ${text} -> ${href}`);
        });

        // Try any table with address data
        $('table tr').each((i, row) => {
          if (i === 0) return;
          const cells = $(row).find('td');
          if (cells.length < 2) return;
          const address = $(cells[0]).text().trim() || $(cells[1]).text().trim();
          if (!address || address.length < 10) return;
          const href = $(row).find('a').first().attr('href');
          results.push({
            address:      address.replace(/,?\s*(TX|Texas|\d{5}).*/i, '').trim(),
            city:         extractCity($(row).text()) || 'Dallas',
            county:       'Dallas',
            property_type: 'SFR',
            sale_type:    'Foreclosure',
            status:       'Active',
            auction_date: upcomingTuesday,
            list_date:    new Date().toISOString().split('T')[0],
            source:       'Dallas County Clerk',
            source_id:    `DCC-${address.replace(/\W+/g, '-').substring(0, 60)}`,
            source_url:   href
              ? (href.startsWith('http') ? href : `https://www.dallascounty.org${href}`)
              : 'https://www.dallascounty.org/departments/countyclerk/foreclosure.php',
            description:  'Foreclosure notice from Dallas County Clerk. Auction at Dallas County Courthouse.',
          });
        });

        console.log(`[Dallas Co Clerk] Found ${results.length - prevLen} properties`);
      }
      await page.close();
    } catch (e) {
      console.error('[Dallas Co Clerk] Error:', e.message);
    }

    console.log(`[Dallas County] Total: ${results.length} properties`);
  } catch (err) {
    console.error('[Dallas County] Fatal error:', err.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  return results;
}

function isDallasCity(text) {
  const t = text.toLowerCase();
  return DALLAS_CITIES.some(c => t.includes(c.toLowerCase()));
}

function extractCity(text) {
  for (const c of DALLAS_CITIES) {
    if (text.includes(c)) return c;
  }
  return null;
}

function fmtDate(str) {
  if (!str) return null;
  try {
    const d = new Date(str);
    if (!isNaN(d)) return d.toISOString().split('T')[0];
  } catch {}
  return null;
}

module.exports = { scrapeDallasCountyForeclosures, nextFirstTuesdays };
