/**
 * Auction.com Scraper — Dallas County, TX
 *
 * Scrapes up to 3 pages of Dallas County residential listings.
 * Extraction strategy (per page):
 *   1. Intercept JSON API response (fastest)
 *   2. DOM evaluation of rendered asset cards (reliable)
 *   3. JSON-LD structured data (fallback)
 */
const { launchBrowser, newPage } = require('./browser');

const BASE_URL = 'https://www.auction.com/residential/texas/dallas-county/';

// Known multi-word Dallas-area city slugs (lowercase, hyphen-separated)
const KNOWN_CITIES_2 = [
  'grand-prairie', 'balch-springs', 'oak-leaf', 'farmers-branch',
  'cedar-hill', 'glenn-heights', 'cockrell-hill', 'de-soto',
  'oak-cliff', 'north-dallas', 'south-dallas', 'lake-highlands',
  'university-park', 'highland-park', 'oak-lawn', 'white-rock',
  'pleasant-grove', 'far-north-dallas',
];
const KNOWN_CITIES_1 = [
  'dallas', 'irving', 'garland', 'mesquite', 'desoto', 'lancaster',
  'rowlett', 'hutchins', 'wilmer', 'seagoville', 'sunnyvale', 'sachse',
  'richardson', 'carrollton', 'duncanville',
];

async function scrapeAuctionDotCom() {
  const results = [];
  const seenIds = new Set();
  let browser;

  try {
    browser = await launchBrowser();

    for (let pageNum = 1; pageNum <= 3; pageNum++) {
      const url  = pageNum === 1 ? BASE_URL : `${BASE_URL}?page=${pageNum}`;
      const page = await newPage(browser);

      // Method 1: intercept JSON API
      let apiData = null;
      page.on('response', async resp => {
        try {
          const rUrl = resp.url();
          const ct   = resp.headers()['content-type'] || '';
          if (!ct.includes('json')) return;
          if (rUrl.includes('auction.com') &&
              (rUrl.includes('/search') || rUrl.includes('/assets') ||
               rUrl.includes('/listings') || rUrl.includes('/properties'))) {
            const data = await resp.json().catch(() => null);
            if (data && !apiData) {
              apiData = data;
              console.log(`[Auction.com] p${pageNum} API: ${rUrl.split('?')[0]}`);
            }
          }
        } catch {}
      });

      console.log(`[Auction.com] Navigating page ${pageNum}: ${url}`);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
      await page.humanDelay();

      const pageResults = [];
      const title = await page.title();
      console.log(`[Auction.com] p${pageNum} title: ${title}`);

      // ── API data ────────────────────────────────────────────────────────────
      if (apiData) {
        const listings =
          apiData.listings || apiData.results || apiData.properties ||
          apiData.assets   || apiData.data?.listings || apiData.data?.results ||
          (Array.isArray(apiData) ? apiData : []);
        console.log(`[Auction.com] p${pageNum} API listings: ${listings.length}`);
        for (const l of listings) {
          const county = (l.county || l.countyName || '').toLowerCase();
          if (county && !county.includes('dallas')) continue;
          const prop = normalizeListing(l);
          if (prop && !seenIds.has(prop.source_id)) {
            seenIds.add(prop.source_id);
            pageResults.push(prop);
          }
        }
      }

      // ── DOM card extraction ─────────────────────────────────────────────────
      if (pageResults.length === 0) {
        console.log(`[Auction.com] p${pageNum} trying DOM extraction...`);

        // Scroll down to trigger lazy loading of more cards
        try {
          await page.waitForSelector('[data-elm-id^="asset_"]', { timeout: 15000 });
          // Scroll to bottom to load more
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await new Promise(r => setTimeout(r, 2000));
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await new Promise(r => setTimeout(r, 1500));
        } catch {
          console.log(`[Auction.com] p${pageNum} no asset cards found`);
        }

        const cards = await page.evaluate((cities2, cities1) => {
          const roots = document.querySelectorAll('[data-elm-id^="asset_"][data-elm-id$="_root"]');
          return Array.from(roots).map(root => {
            const link    = root.querySelector('a[href*="/details/"]');
            const imgSpan = root.querySelector('[aria-label]');
            const allText = root.innerText || root.textContent || '';

            const priceMatch = allText.match(/\$[\d,]+/);
            const price = priceMatch ? parseFloat(priceMatch[0].replace(/[^0-9.]/g, '')) : null;

            const ariaLabel = imgSpan ? imgSpan.getAttribute('aria-label') : '';
            const href      = link ? link.getAttribute('href') : '';

            let address = '', city = '', zip = '', assetId = '';
            if (href) {
              const m = href.match(/\/details\/(.+)-(\d+)$/);
              if (m) {
                assetId = m[2];
                const slug     = m[1];
                const noState  = slug.replace(/-tx$/, '');
                let citySlug = '', addressSlug = noState;

                // Try 2-word city
                for (const c of cities2) {
                  if (noState.endsWith('-' + c) || noState === c) {
                    citySlug = c;
                    addressSlug = noState.slice(0, noState.length - c.length - 1);
                    break;
                  }
                }
                // Try 1-word city
                if (!citySlug) {
                  const parts = noState.split('-');
                  const last  = parts[parts.length - 1];
                  if (cities1.includes(last)) {
                    citySlug    = last;
                    addressSlug = parts.slice(0, -1).join('-');
                  } else {
                    citySlug    = last;
                    addressSlug = parts.slice(0, -1).join('-');
                  }
                }

                city    = citySlug.replace(/-/g, ' ').replace(/\w+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
                address = addressSlug.replace(/-/g, ' ').replace(/\w+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
              }
            }

            // Zip from aria-label
            if (ariaLabel) {
              const zm = ariaLabel.match(/(\d{5})/);
              if (zm) zip = zm[1];
              if (!city) {
                const cm = ariaLabel.trim().match(/^(.+),\s*TX\s*(\d{5})?/i);
                if (cm) { city = cm[1].trim(); zip = zip || cm[2] || ''; }
              }
            }

            return { address, city, zip, href, assetId, price };
          });
        }, KNOWN_CITIES_2, KNOWN_CITIES_1);

        console.log(`[Auction.com] p${pageNum} DOM cards: ${cards.length}`);
        for (const c of cards) {
          if (!c.address || c.address.length < 3) continue;
          const sourceId = `AUCTION-${c.assetId || c.address.replace(/\W+/g, '-').substring(0, 50)}`;
          if (seenIds.has(sourceId)) continue;
          seenIds.add(sourceId);
          pageResults.push({
            address:       c.address,
            city:          c.city || 'Dallas',
            zip_code:      c.zip  || null,
            county:        'Dallas',
            price:         c.price || null,
            property_type: 'SFR',
            sale_type:     'Foreclosure',
            status:        'Active',
            source:        'Auction.com',
            source_id:     sourceId,
            source_url:    c.href ? `https://www.auction.com${c.href}` : BASE_URL,
            description:   'Auction.com online foreclosure auction. Register to bid at auction.com.',
          });
        }
      }

      // ── JSON-LD fallback ────────────────────────────────────────────────────
      if (pageResults.length === 0) {
        console.log(`[Auction.com] p${pageNum} trying JSON-LD...`);
        const blocks = await page.evaluate(() => {
          const scripts = document.querySelectorAll('script[type="application/ld+json"]');
          return Array.from(scripts).map(s => {
            try { return JSON.parse(s.textContent); } catch { return null; }
          }).filter(Boolean);
        });

        for (const block of blocks) {
          const items = Array.isArray(block) ? block : [block];
          for (const item of items) {
            const type = (item['@type'] || '').toLowerCase();
            if (!type.includes('residence') && !type.includes('house') &&
                !type.includes('accommodation') && !type.includes('realestate')) continue;
            const addr = item.address || {};
            const street = addr.streetAddress || '';
            if (!street || (addr.addressRegion || '').toUpperCase() !== 'TX') continue;
            const sid = `AUCTION-${street.replace(/\W+/g, '-').substring(0, 60)}`;
            if (seenIds.has(sid)) continue;
            seenIds.add(sid);
            const offer = item.offers || {};
            pageResults.push({
              address:       street.replace(/,?\s*(TX|Texas).*/i, '').trim(),
              city:          toTitleCase(addr.addressLocality || 'Dallas'),
              zip_code:      addr.postalCode || null,
              county:        'Dallas',
              price:         parseFloat(offer.price) || null,
              bedrooms:      parseInt(item.numberOfBedrooms) || null,
              bathrooms:     parseInt(item.numberOfBathroomsTotal) || null,
              sqft:          parseInt(item.floorSize?.value) || null,
              year_built:    parseInt(item.yearBuilt) || null,
              property_type: 'SFR',
              sale_type:     'Foreclosure',
              status:        'Active',
              source:        'Auction.com',
              source_id:     sid,
              source_url:    (item.url || BASE_URL).startsWith('http') ? item.url : `https://www.auction.com${item.url || ''}`,
              description:   item.description || 'Auction.com foreclosure auction.',
            });
          }
        }
      }

      console.log(`[Auction.com] p${pageNum}: ${pageResults.length} properties`);
      results.push(...pageResults);

      await page.close().catch(() => {});

      // Stop paginating if no results on this page
      if (pageResults.length === 0) {
        console.log(`[Auction.com] No results on page ${pageNum}, stopping pagination`);
        break;
      }
    }

    console.log(`[Auction.com] Total: ${results.length} properties`);
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
  if (!address) return null;

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
    source_id:      String(l.id || l.listingId || l.propertyId || address.replace(/\W+/g,'-')).substring(0, 80),
    source_url:     l.url
      ? (l.url.startsWith('http') ? l.url : `https://www.auction.com${l.url}`)
      : BASE_URL,
    description:
      l.description ||
      `Auction.com ${l.listingType === 'BUY' ? 'bank-owned' : 'foreclosure'} auction.`,
  };
}

function normalizeType(t) {
  if (!t) return 'SFR';
  const s = t.toLowerCase();
  if (s.includes('condo') || s.includes('townhouse')) return 'Condo';
  if (s.includes('multi') || s.includes('duplex'))     return 'Multi-Family';
  if (s.includes('land') || s.includes('lot'))         return 'Land';
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
