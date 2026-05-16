/**
 * HUD HomeStore Scraper — Texas-wide.
 *
 * The Texas-wide search (`citystate=Texas`) loads the entire TX HUD inventory
 * (~125–250 listings, 1.2 MB HTML) in a single page. We extract every card
 * and bucket each one into a configured county.
 *
 * Per-card text format (concatenated via textContent):
 *   "BIDS OPEN MM/DD/YYYY ... $PRICE ADDRESS_TOKENS CITY, TX, ZIP N Beds N.N Baths COUNTY_NAME County Case #: XXX-XXXXX ..."
 *
 * The cleanest way to bucket a listing is to extract its "X County" string
 * and match it against the configured county names.
 */
const { launchBrowser, newPage } = require('./browser');
const COUNTIES = require('./counties');

const SEARCH_URL = 'https://www.hudhomestore.gov/searchresult?citystate=Texas';

// Build lookups
const COUNTY_NAMES = new Set(Object.values(COUNTIES).map(c => c.name.toLowerCase()));

async function scrapeHUDHomes() {
  const results = [];
  let browser;

  try {
    browser = await launchBrowser();
    const page = await newPage(browser);

    console.log(`[HUD] Navigating Texas-wide search: ${SEARCH_URL}`);
    await page.goto(SEARCH_URL, { waitUntil: 'networkidle2', timeout: 90000 });
    await page.humanDelay();

    // Scroll a few times to ensure all lazy elements are in the DOM
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.scrollBy(0, 1200));
      await new Promise(r => setTimeout(r, 700));
    }
    await page.evaluate(() => window.scrollTo(0, 0));

    const title = await page.title();
    console.log(`[HUD] Title: "${title}"`);

    const listings = await page.evaluate(() => {
      const out = [];
      const seen = new Set();

      // The Texas-wide layout uses anchors with `checkPropertyInStep6('case')` onclick;
      // the per-city layout uses `.case-number` text divs. Union both selectors.
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

        // textContent — innerText skips CSS-hidden elements (most listings
        // are hidden until paginated client-side on the state-wide page)
        const allText = (card.textContent || '').replace(/\s+/g, ' ').trim();
        const allHtml = card.outerHTML || '';

        // Case number (anchor for dedup)
        let caseNumber = null;
        const caseInText = allText.match(/Case #:\s*([\w-]+)/i);
        if (caseInText) caseNumber = caseInText[1];
        if (!caseNumber) {
          const onclickMatch = allHtml.match(/checkPropertyInStep6\(['"]([\w-]+)['"]\)/);
          if (onclickMatch) caseNumber = onclickMatch[1];
        }
        if (!caseNumber) continue;
        if (seen.has(caseNumber)) continue;
        seen.add(caseNumber);

        // County name — always appears as "...Baths {County} County..." in the
        // concatenated text. Anchor on "Baths" to avoid grabbing the word
        // "Baths" itself as part of a 2-word county name.
        let countyName = null;
        const countyAfterBaths = allText.match(/Baths?\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)\s+County\b/);
        if (countyAfterBaths) {
          countyName = countyAfterBaths[1];
        } else {
          // Fallback (cards without bed/bath info)
          const generic = allText.match(/(?:^|\s)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+County\b/);
          if (generic) countyName = generic[1];
        }

        // Address + city + zip: "ADDRESS_TOKENS CITY, TX, ZIP"
        // The city is 1–3 capitalized words right before ", TX, ZIP".
        // The address is everything before that, after a $price.
        let address = null, city = null, zip = null;

        // Try: chunk between $PRICE and Beds keyword — that's "ADDRESS CITY, TX, ZIP"
        const segmentMatch = allText.match(/\$[\d,]+\s+(.+?)\s+\d+\s*Beds?/i);
        if (segmentMatch) {
          const segment = segmentMatch[1];
          const m = segment.match(/^(.+?)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2}),\s*TX,?\s*(\d{5})$/);
          if (m) {
            address = m[1].trim();
            city    = m[2].trim();
            zip     = m[3];
          }
        }
        // Fallback: simpler city/zip extract
        if (!city) {
          const cityZip = allText.match(/([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2}),\s*TX,?\s*(\d{5})/);
          if (cityZip) { city = cityZip[1].trim(); zip = cityZip[2]; }
        }
        if (!address) {
          // street # + words + suffix
          const addrM = allText.match(/(\d{1,6}\s+(?:[NSEW]\.?\s+)?[A-Z][\w.\s]{2,40}?(?:Dr|Drive|St|Street|Ave|Avenue|Ln|Lane|Rd|Road|Blvd|Boulevard|Ct|Court|Cir|Circle|Pl|Place|Way|Pkwy|Trl|Trail|Ter|Terrace|Hwy|Highway|Sq|Square)\.?)/);
          if (addrM) address = addrM[1].trim();
        }

        // Coordinates from the marker's onclick handler
        const coordMatch = allHtml.match(/zoomOnSingleProperty\(([\d.-]+),\s*([\d.-]+)\)/);
        const lat = coordMatch ? parseFloat(coordMatch[1]) : null;
        const lng = coordMatch ? parseFloat(coordMatch[2]) : null;

        const priceMatch = allText.match(/\$([\d,]+)/);
        const price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : null;

        const bedMatch  = allText.match(/(\d+)\s*Beds?\b/i);
        const bathMatch = allText.match(/(\d+(?:\.\d+)?)\s*Baths?\b/i);
        const sqftMatch = allText.match(/([\d,]+)\s*(?:sq\.?\s*ft\.?|sqft|square feet)/i);

        const detailLink = card.querySelector('a[href*="/property"], a[onclick*="checkProperty"]');
        let sourceUrl = null;
        if (detailLink) {
          const href = detailLink.getAttribute('href');
          if (href && href !== '#' && !href.startsWith('javascript')) {
            try { sourceUrl = new URL(href, window.location.href).href; } catch {}
          }
        }

        out.push({
          caseNumber, address, city, zip, countyName,
          lat, lng, price,
          beds:  bedMatch  ? parseInt(bedMatch[1]) : null,
          baths: bathMatch ? parseFloat(bathMatch[1]) : null,
          sqft:  sqftMatch ? parseInt(sqftMatch[1].replace(/,/g, '')) : null,
          sourceUrl,
        });
      }
      return out;
    });

    console.log(`[HUD] Total TX listings rendered: ${listings.length}`);

    // Bucket by extracted county name → configured counties.js
    const byCounty = {};
    for (const l of listings) {
      if (!l.address || l.address.length < 5) continue;
      if (!l.countyName) continue;
      if (!COUNTY_NAMES.has(l.countyName.toLowerCase())) continue;

      const cleanAddress = l.address
        .split(/\r?\n/)[0]
        .replace(/,\s*(TX|Texas).*/i, '')
        .trim()
        .substring(0, 200);

      results.push({
        address:       cleanAddress,
        city:          l.city || l.countyName,
        zip_code:      l.zip || null,
        county:        l.countyName,
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
      byCounty[l.countyName] = (byCounty[l.countyName] || 0) + 1;
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
