/**
 * HUD HomeStore Scraper — Dallas County, TX
 *
 * HUD HomeStore renders search results server-side in HTML.
 * Search URL: https://www.hudhomestore.gov/searchresult?citystate=Dallas%2C%20TX
 *
 * Each listing card has:
 *   - case-number: "Case #: XXX-XXXXXX"
 *   - lat/lng in onclick attribute (zoomOnSingleProperty)
 *   - "Dallas County" text
 *   - address in card title/heading
 *   - price displayed prominently
 */
const { launchBrowser, newPage } = require('./browser');

const SEARCH_URL = 'https://www.hudhomestore.gov/searchresult?citystate=Dallas%2C%20TX';

async function scrapeHUDHomes() {
  const results = [];
  let browser;

  try {
    browser = await launchBrowser();
    const page = await newPage(browser);

    console.log('[HUD] Navigating to Dallas County search results...');
    await page.goto(SEARCH_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.humanDelay();

    const title = await page.title();
    console.log(`[HUD] Title: "${title}"`);

    // Extract listings from the rendered DOM
    const listings = await page.evaluate(() => {
      const out = [];

      // Find all elements containing a Case # — these mark listing cards
      const allDivs = Array.from(document.querySelectorAll('.case-number, [class*="case-number"]'));

      for (const caseEl of allDivs) {
        // Walk up to find the listing card container
        let card = caseEl;
        for (let i = 0; i < 8 && card; i++) {
          if (card.classList && (
              card.classList.toString().match(/property|listing|search-result|result-item|card/i)
          )) break;
          card = card.parentElement;
        }
        if (!card) card = caseEl.parentElement?.parentElement?.parentElement;
        if (!card) continue;

        const allText = card.innerText || card.textContent || '';
        const allHtml = card.outerHTML || '';

        // Case number
        const caseMatch = allText.match(/Case #:\s*([\w-]+)/i);
        const caseNumber = caseMatch ? caseMatch[1] : null;
        if (!caseNumber) continue;

        // Lat/lng from onclick
        const coordMatch = allHtml.match(/zoomOnSingleProperty\(([\d.-]+),\s*([\d.-]+)\)/);
        const lat = coordMatch ? parseFloat(coordMatch[1]) : null;
        const lng = coordMatch ? parseFloat(coordMatch[2]) : null;

        // Address — usually in an h2/h3/title or first link/strong
        let address = '';
        const titleEl = card.querySelector('h2, h3, h4, .title, .property-title, .address, [class*="address"], .property-address');
        if (titleEl) address = titleEl.innerText.trim();
        if (!address) {
          // Try first <a> link inside card
          const link = card.querySelector('a[href*="/property"], a[href*="/listing"], a[href*="/details"]');
          if (link) address = link.innerText.trim();
        }
        if (!address) {
          // Fallback: look for address-like pattern in text (number + street)
          const m = allText.match(/(\d+\s+[A-Z][\w\s]+(?:\s(?:DR|ST|AVE|LN|RD|BLVD|CT|CIR|PL|WAY|TRL|TER|SQ))[^\n]{0,40})/i);
          if (m) address = m[1].trim();
        }

        // Price — look for $XXX,XXX
        const priceMatch = allText.match(/\$([\d,]+)/);
        const price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : null;

        // Beds/baths
        const bedMatch  = allText.match(/(\d+)\s*(?:Bed|BR|bd)\b/i);
        const bathMatch = allText.match(/(\d+(?:\.\d+)?)\s*(?:Bath|BA|ba)\b/i);
        const sqftMatch = allText.match(/([\d,]+)\s*(?:sq\.?\s*ft\.?|sqft|square feet)/i);

        // City/zip — try aria-label or visible text
        const cityZipMatch = allText.match(/,\s*([A-Z][A-Za-z\s]+),?\s*TX\s*(\d{5})/);
        const city = cityZipMatch ? cityZipMatch[1].trim() : 'Dallas';
        const zip  = cityZipMatch ? cityZipMatch[2]        : null;

        // Detail link
        const detailLink = card.querySelector('a[href*="/property"], a[href*="/listing/details"], a[href*="/details"]');
        const sourceUrl = detailLink ? new URL(detailLink.getAttribute('href'), window.location.href).href : null;

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

    console.log(`[HUD] Extracted ${listings.length} listings from DOM`);

    for (const l of listings) {
      if (!l.address || l.address.length < 5) {
        console.log(`[HUD] Skipping case ${l.caseNumber}: no address`);
        continue;
      }

      results.push({
        address:       l.address.replace(/,\s*(TX|Texas).*/i, '').trim().substring(0, 200),
        city:          l.city || 'Dallas',
        zip_code:      l.zip || null,
        county:        'Dallas',
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
    }

    console.log(`[HUD] Returning ${results.length} properties`);
  } catch (err) {
    console.error('[HUD] Scrape error:', err.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  return results;
}

module.exports = { scrapeHUDHomes };
