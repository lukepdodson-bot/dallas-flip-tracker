/**
 * Auction.com Scraper — Dallas County, TX
 *
 * Auction.com lists bank-owned and foreclosure properties going to online auction.
 * Site uses Incapsula; puppeteer-extra stealth is used to pass the bot challenge.
 * We intercept the JSON API response the React app makes internally.
 */
const { launchBrowser, newPage } = require('./browser');

const SEARCH_URL =
  'https://www.auction.com/residential/?' +
  'sort=openDate&state=TX&county=Dallas+County&pageNum=1&pageSize=96';

async function scrapeAuctionDotCom() {
  const results = [];
  let browser;

  try {
    browser = await launchBrowser();
    const page = await newPage(browser);

    // Intercept XHR/fetch calls to capture the internal listings API response
    let apiData = null;
    page.on('response', async response => {
      const url = response.url();
      if (
        url.includes('/api/') &&
        (url.includes('search') || url.includes('listing') || url.includes('properties')) &&
        response.headers()['content-type']?.includes('json')
      ) {
        try {
          apiData = await response.json();
          console.log(`[Auction.com] Captured API response from: ${url.split('?')[0]}`);
        } catch {}
      }
    });

    console.log('[Auction.com] Navigating…');
    await page.goto(SEARCH_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.humanDelay();

    const title = await page.title();
    console.log(`[Auction.com] Page title: ${title}`);

    // If we captured a JSON API response, parse it
    if (apiData) {
      const listings =
        apiData.listings ||
        apiData.results ||
        apiData.properties ||
        apiData.data?.listings ||
        apiData.data?.results ||
        [];

      console.log(`[Auction.com] API returned ${listings.length} listings`);

      for (const l of listings) {
        const county = (l.county || l.countyName || '').toLowerCase();
        if (!county.includes('dallas') && county !== '') continue;

        results.push(normalizeListing(l));
      }
    }

    // Fallback: parse the rendered HTML if API wasn't captured
    if (results.length === 0) {
      const html = await page.content();
      const cheerio = require('cheerio');
      const $ = cheerio.load(html);

      const selectors = [
        '[data-testid*="property"]',
        '[class*="PropertyCard"]',
        '[class*="property-card"]',
        '[class*="listing-tile"]',
        '[class*="ListingTile"]',
        'article[class*="listing"]',
      ];

      let cards = $();
      for (const sel of selectors) {
        cards = $(sel);
        if (cards.length > 0) {
          console.log(`[Auction.com] Found ${cards.length} cards with selector: ${sel}`);
          break;
        }
      }

      cards.each((_, card) => {
        const text    = $(card).text();
        const address = $(card).find('[class*="address" i], [class*="street" i]').first().text().trim()
                     || $(card).find('h2, h3').first().text().trim();
        const priceEl = $(card).find('[class*="price" i], [class*="bid" i]').first().text();
        const price   = parseFloat(priceEl.replace(/[^0-9.]/g, '')) || null;
        const href    = $(card).find('a[href*="/detail"], a[href*="/property"]').first().attr('href')
                     || $(card).closest('a').attr('href')
                     || $(card).find('a').first().attr('href');

        if (!address || address.length < 5) return;
        // Rough Dallas County filter
        if (text && !text.toLowerCase().includes('dallas') && !text.toLowerCase().includes('tx')) return;

        results.push({
          address:   address.replace(/,?\s*(TX|Texas).*/i, '').trim(),
          city:      extractCity(text) || 'Dallas',
          county:    'Dallas',
          price,
          property_type: 'SFR',
          sale_type: 'Foreclosure',
          status:    'Active',
          source:    'Auction.com',
          source_id: `AUCTION-${address.replace(/\W+/g, '-')}`,
          source_url: href
            ? (href.startsWith('http') ? href : `https://www.auction.com${href}`)
            : null,
          description: 'Auction.com online auction. Register to bid at auction.com.',
        });
      });
    }

    console.log(`[Auction.com] Returning ${results.length} properties`);
  } catch (err) {
    console.error('[Auction.com] Scrape error:', err.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  return results;
}

function normalizeListing(l) {
  const address =
    l.address || l.streetAddress || l.street_address ||
    [l.streetNum, l.streetName].filter(Boolean).join(' ');

  return {
    address:        (address || '').replace(/,?\s*(TX|Texas).*/i, '').trim(),
    city:           l.city || l.cityName || 'Dallas',
    zip_code:       l.zip  || l.postalCode || l.zipCode || null,
    county:         'Dallas',
    lat:            l.latitude  || l.lat || null,
    lng:            l.longitude || l.lng || null,
    price:          l.openingBid || l.startingBid || l.price || l.currentBid || null,
    estimated_value: l.assessedValue || l.estimatedValue || l.arv || null,
    bedrooms:       l.beds   || l.bedrooms   || null,
    bathrooms:      l.baths  || l.bathrooms  || null,
    sqft:           l.sqft   || l.squareFeet || null,
    year_built:     l.yearBuilt || null,
    property_type:  normalizeType(l.propertyType),
    sale_type:      l.listingType === 'BUY' ? 'REO' : 'Foreclosure',
    status:         'Active',
    auction_date:   fmtDate(l.auctionDate || l.openDate || l.saleDate),
    list_date:      fmtDate(l.listDate || l.startDate),
    source:         'Auction.com',
    source_id:      String(l.id || l.listingId || l.propertyId || address.replace(/\W+/g,'-')),
    source_url:     l.url
      ? (l.url.startsWith('http') ? l.url : `https://www.auction.com${l.url}`)
      : null,
    description:
      l.description ||
      `Auction.com ${l.listingType === 'BUY' ? 'bank-owned' : 'foreclosure'} auction. ` +
      `Opening bid: ${l.openingBid ? '$' + Number(l.openingBid).toLocaleString() : 'TBD'}.`,
  };
}

function normalizeType(t) {
  if (!t) return 'SFR';
  const s = t.toLowerCase();
  if (s.includes('condo') || s.includes('townhouse')) return 'Condo';
  if (s.includes('multi') || s.includes('duplex'))     return 'Multi-Family';
  if (s.includes('land') || s.includes('lot'))         return 'Land';
  if (s.includes('commercial'))                        return 'Commercial';
  return 'SFR';
}

function extractCity(text) {
  const dallas  = ['Dallas','Irving','Garland','Mesquite','DeSoto','Lancaster','Rowlett','Grand Prairie','Duncanville','Balch Springs','Hutchins','Wilmer','Seagoville','Sunnyvale','Sachse','Farmers Branch'];
  for (const c of dallas) {
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

module.exports = { scrapeAuctionDotCom };
