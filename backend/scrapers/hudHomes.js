/**
 * HUD HomeStore Scraper — Dallas County, TX
 *
 * HUD sells foreclosed homes originally financed with FHA-insured loans.
 * Site is behind Incapsula; we use puppeteer-extra with the stealth plugin
 * to pass the bot challenge and hit their ASP.NET search page.
 */
const cheerio = require('cheerio');
const { launchBrowser, newPage } = require('./browser');

const SEARCH_URL =
  'https://www.hudhomestore.gov/Listing/PropertySearchResult.aspx' +
  '?zipCode=&city=&state=TX&county=DALLAS&propertyType=&listing=' +
  '&bedroom=&bathroom=&garage=&fireplaceFlg=&basementFlg=&acFlg=' +
  '&searchType=searchByCounty&pageNumber=1&pageSize=100' +
  '&sortField=listdate&sortOrder=DESC';

async function scrapeHUDHomes() {
  const results = [];
  let browser;

  try {
    browser = await launchBrowser();
    const page = await newPage(browser);

    console.log('[HUD] Navigating to HUD HomeStore…');
    await page.goto(SEARCH_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.humanDelay();

    // If Incapsula is still showing a challenge page, wait a bit more
    const title = await page.title();
    console.log(`[HUD] Page title: ${title}`);
    if (title.toLowerCase().includes('error') || title === '') {
      await page.waitForTimeout(5000);
      await page.reload({ waitUntil: 'networkidle2' });
    }

    const html = await page.content();
    const $   = cheerio.load(html);

    // HUD results are in a table — try both possible table selectors
    const rows = $('table#dgSearchResult tr, table.table tr, .listing-row');
    console.log(`[HUD] Found ${rows.length} table rows`);

    rows.each((i, row) => {
      if (i === 0) return; // header
      const cells = $(row).find('td');
      if (cells.length < 4) return;

      const linkEl   = $(cells[0]).find('a');
      const address  = linkEl.text().trim() || $(cells[0]).text().trim();
      const city     = $(cells[1]).text().trim();
      const state    = $(cells[2]).text().trim();
      const zip      = $(cells[3]).text().trim();
      const price    = parseFloat($(cells[4]).text().replace(/[^0-9.]/g, '')) || null;
      const beds     = parseInt($(cells[5]).text()) || null;
      const baths    = parseFloat($(cells[6]).text()) || null;
      const listDate = $(cells[7]).text().trim();
      const caseNum  = $(cells[8]).text().trim() || $(cells[9]).text().trim();
      const href     = linkEl.attr('href');

      if (!address || address.length < 5) return;
      if (state && state.toUpperCase() !== 'TX') return;

      const sourceId = caseNum || `HUD-TX-${address.replace(/\W+/g, '-')}`;
      results.push({
        address:    address.replace(/,\s*(TX|Texas).*/i, '').trim(),
        city:       city || 'Dallas',
        zip_code:   zip   || null,
        county:     'Dallas',
        price,
        bedrooms:   beds,
        bathrooms:  baths,
        list_date:  listDate ? fmtDate(listDate) : null,
        property_type: 'SFR',
        sale_type:  'REO',
        status:     'Active',
        source:     'HUD Homes',
        source_id:  sourceId,
        source_url: href
          ? (href.startsWith('http') ? href : `https://www.hudhomestore.gov${href}`)
          : null,
        case_number: caseNum || null,
        description:
          'HUD Home — sold as-is. Contact listing broker for showing instructions. ' +
          'FHA financing may be available with escrow repair addendum.',
      });
    });

    // Try alternate card layout if table had no rows
    if (results.length === 0) {
      $('[class*="property-card"], [class*="listing-card"], [class*="PropertyCard"]').each((_, card) => {
        const address = $(card).find('[class*="address"], [class*="Address"]').first().text().trim();
        const price   = parseFloat($(card).find('[class*="price"], [class*="Price"]').first().text().replace(/[^0-9.]/g, '')) || null;
        const href    = $(card).find('a').first().attr('href');
        if (!address) return;
        results.push({
          address, city: 'Dallas', county: 'Dallas',
          price, property_type: 'SFR', sale_type: 'REO', status: 'Active',
          source: 'HUD Homes',
          source_id: `HUD-TX-${address.replace(/\W+/g, '-')}`,
          source_url: href ? `https://www.hudhomestore.gov${href}` : null,
          description: 'HUD Home — sold as-is.',
        });
      });
    }

    console.log(`[HUD] Returning ${results.length} properties`);
  } catch (err) {
    console.error('[HUD] Scrape error:', err.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  return results;
}

function fmtDate(str) {
  try {
    const d = new Date(str);
    if (!isNaN(d)) return d.toISOString().split('T')[0];
  } catch {}
  return null;
}

module.exports = { scrapeHUDHomes };
