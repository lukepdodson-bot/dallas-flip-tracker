/**
 * HUD HomeStore Scraper — Dallas County, TX
 *
 * HUD HomeStore now uses Yardi Systems as backend.
 * The search API endpoint is at /api/Listing/GetListings
 * We navigate to the main search page and intercept the API call,
 * or fall back to parsing the rendered HTML.
 */
const { launchBrowser, newPage } = require('./browser');

// HUD HomeStore Yardi-based search — state=TX, county=dallas
const SEARCH_URL = 'https://www.hudhomestore.gov/?StateCode=TX&CountyCode=113&SearchType=ST';
// Alternative API endpoint (intercepted from browser DevTools)
const API_URL = 'https://www.hudhomestore.gov/api/Listing/GetListings';

async function scrapeHUDHomes() {
  const results = [];
  let browser;

  try {
    browser = await launchBrowser();
    const page = await newPage(browser);

    // Intercept API calls from Yardi
    let apiData = null;
    page.on('response', async response => {
      try {
        const url = response.url();
        const ct  = response.headers()['content-type'] || '';
        if (!ct.includes('json')) return;
        if (
          url.includes('hudhomestore.gov') &&
          (url.includes('/api/') || url.includes('GetListings') ||
           url.includes('PropertySearch') || url.includes('search') ||
           url.includes('listing'))
        ) {
          const data = await response.json().catch(() => null);
          if (data && !apiData) {
            apiData = data;
            console.log(`[HUD] Captured API: ${url.split('?')[0]}`);
          }
        }
      } catch {}
    });

    console.log('[HUD] Navigating to HUD HomeStore Dallas County search...');
    await page.goto(SEARCH_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.humanDelay();

    const title = await page.title();
    console.log(`[HUD] Title: "${title}"`);

    // ── Method 1: API response captured via network interception ─────────────
    if (apiData) {
      console.log(`[HUD] API data keys: ${Object.keys(apiData).slice(0, 8).join(', ')}`);
      const listings =
        apiData.listings    ||
        apiData.properties  ||
        apiData.results     ||
        apiData.data        ||
        apiData.Items       ||
        apiData.items       ||
        (Array.isArray(apiData) ? apiData : []);

      console.log(`[HUD] API listings: ${listings.length}`);
      for (const l of listings) {
        const r = parseHudListing(l);
        if (r) results.push(r);
      }
    }

    // ── Method 2: Try direct API call via page context ────────────────────────
    if (results.length === 0) {
      console.log('[HUD] Trying direct API fetch from page context...');
      const apiResults = await page.evaluate(async () => {
        const endpoints = [
          '/api/Listing/GetListings?StateCode=TX&CountyCode=113&PageNumber=1&PageSize=100',
          '/api/properties?state=TX&county=DALLAS&page=1&pageSize=100',
          '/Listing/PropertySearchResult.aspx?state=TX&county=DALLAS&searchType=searchByCounty&pageNumber=1&pageSize=50',
        ];
        for (const ep of endpoints) {
          try {
            const res = await fetch('https://www.hudhomestore.gov' + ep, {
              headers: { 'Accept': 'application/json, text/html, */*' }
            });
            const ct = res.headers.get('content-type') || '';
            if (ct.includes('json')) {
              const data = await res.json();
              return { url: ep, data };
            }
          } catch {}
        }
        return null;
      }).catch(() => null);

      if (apiResults?.data) {
        console.log(`[HUD] Direct API hit: ${apiResults.url}`);
        const listings =
          apiResults.data.listings || apiResults.data.properties ||
          apiResults.data.results  || apiResults.data.data ||
          (Array.isArray(apiResults.data) ? apiResults.data : []);
        for (const l of listings) {
          const r = parseHudListing(l);
          if (r) results.push(r);
        }
      }
    }

    // ── Method 3: Parse rendered HTML ─────────────────────────────────────────
    if (results.length === 0) {
      console.log('[HUD] Falling back to HTML parsing...');
      const html = await page.content();
      const cheerio = require('cheerio');
      const $ = cheerio.load(html);

      // Try table rows first
      const rows = $('table#dgSearchResult tr, table.SearchResults tr, .property-row, [class*="listing-row"]');
      console.log(`[HUD] Table rows found: ${rows.length}`);
      rows.each((i, row) => {
        if (i === 0) return;
        const cells = $(row).find('td');
        if (cells.length < 4) return;
        const linkEl  = $(cells[0]).find('a');
        const address = linkEl.text().trim() || $(cells[0]).text().trim();
        const city    = $(cells[1]).text().trim();
        const state   = $(cells[2]).text().trim();
        const zip     = $(cells[3]).text().trim();
        const price   = parseFloat($(cells[4]).text().replace(/[^0-9.]/g, '')) || null;
        const beds    = parseInt($(cells[5]).text()) || null;
        const baths   = parseFloat($(cells[6]).text()) || null;
        const listDate = $(cells[7]).text().trim();
        const caseNum  = $(cells[8])?.text().trim();
        const href     = linkEl.attr('href');
        if (!address || address.length < 5) return;
        if (state && state.toUpperCase() !== 'TX') return;
        results.push({
          address:    address.replace(/,\s*(TX|Texas).*/i, '').trim(),
          city:       city || 'Dallas',
          zip_code:   zip  || null,
          county:     'Dallas',
          price, bedrooms: beds, bathrooms: baths,
          list_date:  listDate ? fmtDate(listDate) : null,
          property_type: 'SFR', sale_type: 'REO', status: 'Active',
          source:     'HUD Homes',
          source_id:  caseNum || `HUD-TX-${address.replace(/\W+/g, '-').substring(0, 60)}`,
          source_url: href
            ? (href.startsWith('http') ? href : `https://www.hudhomestore.gov${href}`)
            : null,
          case_number: caseNum || null,
          description: 'HUD Home — sold as-is. FHA financing may be available with escrow repair addendum.',
        });
      });

      // Try card layout
      if (results.length === 0) {
        $('[class*="property-card"], [class*="listing-card"], [class*="PropertyCard"], [class*="home-card"]').each((_, card) => {
          const address = $(card).find('[class*="address" i], [class*="street" i]').first().text().trim();
          const price   = parseFloat($(card).find('[class*="price" i]').first().text().replace(/[^0-9.]/g, '')) || null;
          const href    = $(card).find('a').first().attr('href');
          if (!address) return;
          results.push({
            address, city: 'Dallas', county: 'Dallas',
            price, property_type: 'SFR', sale_type: 'REO', status: 'Active',
            source: 'HUD Homes',
            source_id: `HUD-TX-${address.replace(/\W+/g, '-').substring(0, 60)}`,
            source_url: href
              ? (href.startsWith('http') ? href : `https://www.hudhomestore.gov${href}`)
              : 'https://www.hudhomestore.gov',
            description: 'HUD Home — sold as-is.',
          });
        });
      }
    }

    console.log(`[HUD] Returning ${results.length} properties`);
  } catch (err) {
    console.error('[HUD] Scrape error:', err.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  return results;
}

function parseHudListing(l) {
  const address =
    l.address || l.streetAddress || l.street || l.PropertyAddress ||
    l.Street1 || l.street1 || '';
  if (!address || address.length < 5) return null;
  const state = (l.state || l.State || l.stateCode || '').toUpperCase();
  if (state && state !== 'TX') return null;

  return {
    address:       address.replace(/,\s*(TX|Texas).*/i, '').trim(),
    city:          l.city  || l.City  || l.cityName  || 'Dallas',
    zip_code:      l.zip   || l.Zip   || l.zipCode   || l.postalCode || null,
    county:        'Dallas',
    price:         parseFloat(l.price || l.listPrice || l.ListPrice || l.Price) || null,
    bedrooms:      parseInt(l.beds || l.bedrooms || l.Bedrooms || l.BedroomCnt) || null,
    bathrooms:     parseFloat(l.baths || l.bathrooms || l.Bathrooms || l.BathroomCnt) || null,
    sqft:          parseInt(l.sqft || l.squareFeet || l.SquareFeet || l.LivingArea) || null,
    year_built:    parseInt(l.yearBuilt || l.YearBuilt) || null,
    property_type: 'SFR',
    sale_type:     'REO',
    status:        'Active',
    list_date:     fmtDate(l.listDate || l.ListDate || l.listingDate),
    source:        'HUD Homes',
    source_id:     String(l.caseNumber || l.CaseNumber || l.id || l.propertyId || address.replace(/\W+/g,'-')).substring(0, 80),
    source_url:    l.url
      ? (l.url.startsWith('http') ? l.url : `https://www.hudhomestore.gov${l.url}`)
      : 'https://www.hudhomestore.gov',
    case_number:   l.caseNumber || l.CaseNumber || null,
    description:   'HUD Home — sold as-is. Contact listing broker for showing instructions. ' +
                   'FHA financing may be available with escrow repair addendum.',
  };
}

function fmtDate(str) {
  if (!str) return null;
  try {
    const d = new Date(str);
    if (!isNaN(d)) return d.toISOString().split('T')[0];
  } catch {}
  return null;
}

module.exports = { scrapeHUDHomes };
