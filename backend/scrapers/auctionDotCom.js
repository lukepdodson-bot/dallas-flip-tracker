/**
 * Auction.com Scraper — Dallas County, TX
 *
 * Navigates to the Dallas County residential search page,
 * waits for React cards to render, then extracts property data via:
 *   1. Intercepted JSON API response (fastest)
 *   2. JSON-LD <script> tags embedded in the page (cleanest)
 *   3. DOM evaluation of rendered cards (fallback)
 */
const { launchBrowser, newPage } = require('./browser');

const SEARCH_URL = 'https://www.auction.com/residential/texas/dallas-county/';

async function scrapeAuctionDotCom() {
  const results = [];
  let browser;

  try {
    browser = await launchBrowser();
    const page = await newPage(browser);

    // Intercept JSON API responses
    let apiData = null;
    page.on('response', async response => {
      try {
        const url = response.url();
        const ct  = response.headers()['content-type'] || '';
        if (!ct.includes('json')) return;
        // Auction.com's internal search API
        if (
          url.includes('auction.com') &&
          (url.includes('/search') || url.includes('/assets') || url.includes('/listings') || url.includes('/properties'))
        ) {
          const data = await response.json().catch(() => null);
          if (data && !apiData) {
            apiData = data;
            console.log(`[Auction.com] Captured API: ${url.split('?')[0]} (keys: ${Object.keys(data).slice(0, 5).join(', ')})`);
          }
        }
      } catch {}
    });

    console.log('[Auction.com] Navigating to Dallas County search...');
    await page.goto(SEARCH_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.humanDelay();

    const title = await page.title();
    console.log(`[Auction.com] Title: ${title}`);

    // ── Method 1: Use captured API data ──────────────────────────────────────
    if (apiData) {
      const listings =
        apiData.listings ||
        apiData.results  ||
        apiData.properties ||
        apiData.assets   ||
        apiData.data?.listings ||
        apiData.data?.results  ||
        (Array.isArray(apiData) ? apiData : []);

      console.log(`[Auction.com] API listings: ${listings.length}`);
      for (const l of listings) {
        const county = (l.county || l.countyName || '').toLowerCase();
        if (county && !county.includes('dallas')) continue;
        results.push(normalizeListing(l));
      }
    }

    // ── Method 2: JSON-LD structured data ────────────────────────────────────
    if (results.length === 0) {
      console.log('[Auction.com] Trying JSON-LD extraction...');
      const jsonLdBlocks = await page.evaluate(() => {
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        return Array.from(scripts).map(s => {
          try { return JSON.parse(s.textContent); } catch { return null; }
        }).filter(Boolean);
      });

      for (const block of jsonLdBlocks) {
        const items = Array.isArray(block) ? block : [block];
        for (const item of items) {
          // Skip non-property schema types
          const type = (item['@type'] || '').toLowerCase();
          if (!type.includes('residence') && !type.includes('house') &&
              !type.includes('accommodation') && !type.includes('realestate') &&
              !type.includes('property')) continue;

          const addr = item.address || {};
          const streetAddress = addr.streetAddress || '';
          if (!streetAddress) continue;
          // Dallas County filter
          const region = (addr.addressRegion || '').toUpperCase();
          const locality = (addr.addressLocality || '').toUpperCase();
          if (region !== 'TX') continue;

          const offer = (item.offers || {});
          const price = parseFloat(offer.price) || null;
          const url   = item.url || '';

          results.push({
            address:       streetAddress.replace(/,?\s*(TX|Texas).*/i, '').trim(),
            city:          toTitleCase(addr.addressLocality || 'Dallas'),
            zip_code:      addr.postalCode || null,
            county:        'Dallas',
            price,
            bedrooms:      parseInt(item.numberOfBedrooms)  || null,
            bathrooms:     parseInt(item.numberOfBathroomsTotal) || null,
            sqft:          parseInt(item.floorSize?.value)  || null,
            year_built:    parseInt(item.yearBuilt)         || null,
            property_type: 'SFR',
            sale_type:     'Foreclosure',
            status:        'Active',
            source:        'Auction.com',
            source_id:     `AUCTION-${streetAddress.replace(/\W+/g, '-').substring(0, 60)}`,
            source_url:    url.startsWith('http') ? url : (url ? `https://www.auction.com${url}` : SEARCH_URL),
            description:   item.description || 'Auction.com foreclosure auction. Register to bid.',
          });
        }
      }
      console.log(`[Auction.com] JSON-LD extracted ${results.length} properties`);
    }

    // ── Method 3: DOM evaluation of rendered cards ────────────────────────────
    if (results.length === 0) {
      console.log('[Auction.com] Trying DOM card extraction...');
      try {
        await page.waitForSelector('[data-elm-id^="asset_"]', { timeout: 15000 });
      } catch {
        console.log('[Auction.com] No asset cards found within 15s');
      }

      // Known multi-word Dallas-area city slugs (lowercase, hyphen-separated)
      const KNOWN_CITIES = [
        'grand-prairie','balch-springs','oak-leaf','farmers-branch',
        'cedar-hill','glenn-heights','cockrell-hill','de-soto','desoto',
        'oak-cliff','north-dallas','south-dallas','lake-highlands',
        'university-park','highland-park','oak-lawn','white-rock',
        'pleasant-grove','far-north-dallas',
      ];
      const KNOWN_CITIES_1 = [
        'dallas','irving','garland','mesquite','desoto','lancaster',
        'rowlett','hutchins','wilmer','seagoville','sunnyvale','sachse',
        'richardson','carrollton','duncanville',
      ];

      const cards = await page.evaluate((knownCities2, knownCities1) => {
        const roots = document.querySelectorAll('[data-elm-id^="asset_"][data-elm-id$="_root"]');
        return Array.from(roots).map(root => {
          const link    = root.querySelector('a[href*="/details/"]');
          const imgSpan = root.querySelector('[aria-label]');
          const allText = root.innerText || root.textContent || '';

          // Extract price (look for $ amounts)
          const priceMatch = allText.match(/\$[\d,]+/);
          const price = priceMatch
            ? parseFloat(priceMatch[0].replace(/[^0-9.]/g, ''))
            : null;

          const ariaLabel = imgSpan ? imgSpan.getAttribute('aria-label') : '';
          const href      = link ? link.getAttribute('href') : '';

          // Parse address from href: /details/549-sharp-dr-desoto-tx-2039095
          // or /details/618-royal-ave-grand-prairie-tx-2039102
          let address = '', city = '', zip = '', assetId = '';
          if (href) {
            const match = href.match(/\/details\/(.+)-(\d+)$/);
            if (match) {
              assetId = match[2];
              const slug  = match[1]; // e.g. "618-royal-ave-grand-prairie-tx"
              // Remove trailing "-tx"
              const noState = slug.replace(/-tx$/, '');
              // Try to match a known 2-word city at the end
              let citySlug = '', addressSlug = noState;
              for (const c of knownCities2) {
                if (noState.endsWith('-' + c) || noState === c) {
                  citySlug = c;
                  addressSlug = noState.slice(0, noState.length - c.length - 1);
                  break;
                }
              }
              // Fallback: try 1-word city
              if (!citySlug) {
                const parts = noState.split('-');
                const lastWord = parts[parts.length - 1];
                if (knownCities1.includes(lastWord)) {
                  citySlug = lastWord;
                  addressSlug = parts.slice(0, -1).join('-');
                } else {
                  // Just take the last word as city
                  citySlug = lastWord;
                  addressSlug = parts.slice(0, -1).join('-');
                }
              }
              city    = toTitleCase(citySlug.replace(/-/g, ' '));
              address = toTitleCase(addressSlug.replace(/-/g, ' '));
            }
          }

          // Fallback city from aria-label: "  DeSoto, TX 75115"
          if (!city && ariaLabel) {
            const m = ariaLabel.trim().match(/^(.+),\s*TX\s*(\d{5})?/i);
            if (m) { city = m[1].trim(); zip = m[2] || ''; }
          }
          // Get zip from aria-label
          if (!zip && ariaLabel) {
            const m = ariaLabel.match(/(\d{5})/);
            if (m) zip = m[1];
          }

          return { address, city, zip, href, assetId, price, ariaLabel };
        });

        function toTitleCase(s) {
          return (s || '').replace(/\w+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
        }
      }, KNOWN_CITIES, KNOWN_CITIES_1);

      console.log(`[Auction.com] DOM found ${cards.length} cards`);

      for (const c of cards) {
        if (!c.address || c.address.length < 5) continue;
        results.push({
          address:       c.address,
          city:          c.city || 'Dallas',
          zip_code:      c.zip   || null,
          county:        'Dallas',
          price:         c.price || null,
          property_type: 'SFR',
          sale_type:     'Foreclosure',
          status:        'Active',
          source:        'Auction.com',
          source_id:     `AUCTION-${c.assetId || c.address.replace(/\W+/g, '-').substring(0, 50)}`,
          source_url:    c.href
            ? `https://www.auction.com${c.href}`
            : SEARCH_URL,
          description:   'Auction.com online foreclosure auction. Register to bid at auction.com.',
        });
      }
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
    city:           toTitleCase(l.city || l.cityName || 'Dallas'),
    zip_code:       l.zip || l.postalCode || l.zipCode || null,
    county:         'Dallas',
    lat:            parseFloat(l.latitude  || l.lat) || null,
    lng:            parseFloat(l.longitude || l.lng) || null,
    price:          parseFloat(l.openingBid || l.startingBid || l.price || l.currentBid) || null,
    estimated_value: parseFloat(l.assessedValue || l.estimatedValue || l.arv) || null,
    bedrooms:       parseInt(l.beds   || l.bedrooms)   || null,
    bathrooms:      parseFloat(l.baths || l.bathrooms) || null,
    sqft:           parseInt(l.sqft   || l.squareFeet) || null,
    year_built:     parseInt(l.yearBuilt) || null,
    property_type:  normalizeType(l.propertyType),
    sale_type:      l.listingType === 'BUY' ? 'REO' : 'Foreclosure',
    status:         'Active',
    auction_date:   fmtDate(l.auctionDate || l.openDate || l.saleDate),
    list_date:      fmtDate(l.listDate || l.startDate),
    source:         'Auction.com',
    source_id:      String(l.id || l.listingId || l.propertyId || (address||'').replace(/\W+/g,'-')).substring(0, 80),
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

function toTitleCase(s) {
  if (!s) return s;
  return s.replace(/\w+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
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
