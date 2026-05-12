/**
 * HUD HomeStore Scraper — Texas-wide.
 *
 * The previous approach searched `citystate=Dallas, TX` and `Austin, TX` separately,
 * which returned only 2 total listings. The state-wide search `citystate=Texas`
 * loads ALL Texas inventory (~1.2 MB) in one page. We extract every listing
 * then bucket each one into a configured county by matching its city name.
 *
 * Each listing card has:
 *   - case-number: "Case #: XXX-XXXXXX"
 *   - lat/lng in onclick attribute (zoomOnSingleProperty)
 *   - address in card title/heading
 *   - city/state/zip in "City, TX, ZIP" format
 *   - price displayed prominently
 */
const { launchBrowser, newPage } = require('./browser');
const COUNTIES = require('./counties');

const SEARCH_URL = 'https://www.hudhomestore.gov/searchresult?citystate=Texas';

// Build a city → county map from the config (lowercase keys for matching)
function buildCityToCountyMap() {
  const map = new Map();
  for (const cfg of Object.values(COUNTIES)) {
    for (const city of cfg.cities) {
      map.set(city.toLowerCase(), cfg.name);
    }
  }
  return map;
}

async function scrapeHUDHomes() {
  const results = [];
  let browser;
  const cityMap = buildCityToCountyMap();

  try {
    browser = await launchBrowser();
    const page = await newPage(browser);

    console.log(`[HUD] Navigating Texas-wide search: ${SEARCH_URL}`);
    await page.goto(SEARCH_URL, { waitUntil: 'networkidle2', timeout: 90000 });
    await page.humanDelay();

    const title = await page.title();
    console.log(`[HUD] Title: "${title}"`);

    // Scroll to bottom to trigger any lazy-load
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise(r => setTimeout(r, 1500));
    await page.evaluate(() => window.scrollTo(0, 0));

    const listings = await page.evaluate(() => {
      const out = [];
      const seen = new Set();

      // Anchor on case-number elements OR property links with checkPropertyInStep6 onclick.
      // The Texas-wide list view uses the latter; city-state view uses the former.
      const anchors = [
        ...document.querySelectorAll('.case-number, [class*="case-number"]'),
        ...document.querySelectorAll('a[onclick*="checkPropertyInStep6"], a[onclick*="checkProperty"]'),
        ...document.querySelectorAll('[onclick*="checkPropertyInStep6"]'),
      ];

      for (const anchorEl of anchors) {
        let card = anchorEl;
        for (let i = 0; i < 8 && card; i++) {
          if (card.classList && (
              card.classList.toString().match(/property|listing|search-result|result-item|card/i)
          )) break;
          card = card.parentElement;
        }
        if (!card) card = anchorEl.parentElement?.parentElement?.parentElement;
        if (!card) continue;

        const allText = card.innerText || card.textContent || '';
        const allHtml = card.outerHTML || '';

        // Try multiple case-number patterns:
        //   1. ".case-number" text:  "Case #: XXX-XXXXX"
        //   2. onclick handler:      checkPropertyInStep6('XXX-XXXXX')
        let caseNumber = null;
        const caseMatch = allText.match(/Case #:\s*([\w-]+)/i);
        if (caseMatch) caseNumber = caseMatch[1];
        if (!caseNumber) {
          const onclickMatch = allHtml.match(/checkPropertyInStep6\(['"]([\w-]+)['"]\)/);
          if (onclickMatch) caseNumber = onclickMatch[1];
        }
        if (!caseNumber) continue;
        if (seen.has(caseNumber)) continue;
        seen.add(caseNumber);

        const coordMatch = allHtml.match(/zoomOnSingleProperty\(([\d.-]+),\s*([\d.-]+)\)/);
        const lat = coordMatch ? parseFloat(coordMatch[1]) : null;
        const lng = coordMatch ? parseFloat(coordMatch[2]) : null;

        let address = '';
        const titleEl = card.querySelector('h2, h3, h4, .title, .property-title, .address, [class*="property-address"]');
        if (titleEl) address = titleEl.innerText.trim();
        if (!address) {
          const link = card.querySelector('a[href*="/property"], a[onclick*="checkPropertyInStep6"], a[onclick*="checkProperty"]');
          if (link) address = link.innerText.trim();
        }
        if (!address) {
          const m = allText.match(/(\d+\s+[A-Z][\w\s]+(?:\s(?:DR|ST|AVE|LN|RD|BLVD|CT|CIR|PL|WAY|TRL|TER|SQ))[^\n]{0,40})/i);
          if (m) address = m[1].trim();
        }

        const priceMatch = allText.match(/\$([\d,]+)/);
        const price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : null;

        const bedMatch  = allText.match(/(\d+)\s*(?:Bed|BR|bd)\b/i);
        const bathMatch = allText.match(/(\d+(?:\.\d+)?)\s*(?:Bath|BA|ba)\b/i);
        const sqftMatch = allText.match(/([\d,]+)\s*(?:sq\.?\s*ft\.?|sqft|square feet)/i);

        // City/state/zip — HUD format: "City, TX, 75123"
        const cityZipMatch = allText.match(/([A-Z][A-Za-z\s.]+?),\s*TX,?\s*(\d{5})/);
        const city = cityZipMatch ? cityZipMatch[1].trim() : null;
        const zip  = cityZipMatch ? cityZipMatch[2]        : null;

        const detailLink = card.querySelector('a[href*="/property"], a[onclick*="checkProperty"]');
        let sourceUrl = null;
        if (detailLink) {
          const href = detailLink.getAttribute('href');
          if (href && href !== '#' && !href.startsWith('javascript')) {
            try { sourceUrl = new URL(href, window.location.href).href; } catch {}
          }
        }

        out.push({
          caseNumber, address, city, zip,
          lat, lng, price,
          beds: bedMatch ? parseInt(bedMatch[1]) : null,
          baths: bathMatch ? parseFloat(bathMatch[1]) : null,
          sqft: sqftMatch ? parseInt(sqftMatch[1].replace(/,/g, '')) : null,
          sourceUrl,
        });
      }
      return out;
    });

    console.log(`[HUD] Total TX listings rendered: ${listings.length}`);

    // Bucket into our configured counties
    const byCounty = {};
    for (const l of listings) {
      if (!l.address || l.address.length < 5) continue;
      if (!l.city) continue;

      const county = cityMap.get(l.city.toLowerCase());
      if (!county) continue; // skip cities not in any configured county

      const cleanAddress = l.address
        .split(/\r?\n/)[0]
        .replace(/,\s*(TX|Texas).*/i, '')
        .trim()
        .substring(0, 200);

      results.push({
        address:       cleanAddress,
        city:          l.city,
        zip_code:      l.zip || null,
        county:        county,
        lat:           l.lat,
        lng:           l.lng,
        price:         l.price,
        bedrooms:      l.beds,
        bathrooms:     l.baths,
        sqft:          l.sqft,
        property_type: 'SFR',
        sale_type:     'REO',
        status:        'Active',
        source:        'HUD Homes',
        source_id:     `HUD-${l.caseNumber}`,
        source_url:    l.sourceUrl || SEARCH_URL,
        case_number:   l.caseNumber,
        description:   'HUD Home — sold as-is. Contact listing broker for showing instructions. ' +
                       'FHA financing may be available with escrow repair addendum.',
      });
      byCounty[county] = (byCounty[county] || 0) + 1;
    }

    console.log(`[HUD] Kept by county:`, JSON.stringify(byCounty));
    await page.close().catch(() => {});
    console.log(`[HUD] Returning ${results.length} properties`);
  } catch (err) {
    console.error('[HUD] Scrape error:', err.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  return results;
}

module.exports = { scrapeHUDHomes };
