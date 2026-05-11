/**
 * HUD HomeStore Scraper — multi-county.
 *
 * For each configured county, query HUD's searchresult endpoint with the
 * city/state of the main city in that county (Dallas, TX / Austin, TX).
 *
 * Each listing card has:
 *   - case-number: "Case #: XXX-XXXXXX"
 *   - lat/lng in onclick attribute (zoomOnSingleProperty)
 *   - "[County] County" text
 *   - address in card title/heading
 *   - price displayed prominently
 */
const { launchBrowser, newPage } = require('./browser');
const COUNTIES = require('./counties');

async function scrapeHUDHomes() {
  const results = [];
  let browser;

  try {
    browser = await launchBrowser();

    for (const cfg of Object.values(COUNTIES)) {
      const url = `https://www.hudhomestore.gov/searchresult?citystate=${encodeURIComponent(cfg.hudCityState)}`;
      const page = await newPage(browser);
      console.log(`\n[HUD] === ${cfg.name} County (${cfg.hudCityState}) ===`);
      console.log(`[HUD] Navigating: ${url}`);

      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        await page.humanDelay();
        const title = await page.title();
        console.log(`[HUD] Title: "${title}"`);

        const listings = await page.evaluate(() => {
          const out = [];
          const allDivs = Array.from(document.querySelectorAll('.case-number, [class*="case-number"]'));

          for (const caseEl of allDivs) {
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

            const caseMatch = allText.match(/Case #:\s*([\w-]+)/i);
            const caseNumber = caseMatch ? caseMatch[1] : null;
            if (!caseNumber) continue;

            const coordMatch = allHtml.match(/zoomOnSingleProperty\(([\d.-]+),\s*([\d.-]+)\)/);
            const lat = coordMatch ? parseFloat(coordMatch[1]) : null;
            const lng = coordMatch ? parseFloat(coordMatch[2]) : null;

            let address = '';
            const titleEl = card.querySelector('h2, h3, h4, .title, .property-title, .address, [class*="address"], .property-address');
            if (titleEl) address = titleEl.innerText.trim();
            if (!address) {
              const link = card.querySelector('a[href*="/property"], a[href*="/listing"], a[href*="/details"]');
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

            // Extract county for filtering ("Dallas County", "Travis County")
            const countyMatch = allText.match(/([A-Z][a-z]+)\s+County/);
            const county = countyMatch ? countyMatch[1] : null;

            const cityZipMatch = allText.match(/,\s*([A-Z][A-Za-z\s]+),?\s*TX\s*(\d{5})/);
            const city = cityZipMatch ? cityZipMatch[1].trim() : null;
            const zip  = cityZipMatch ? cityZipMatch[2]        : null;

            const detailLink = card.querySelector('a[href*="/property"], a[href*="/listing/details"], a[href*="/details"]');
            const sourceUrl = detailLink ? new URL(detailLink.getAttribute('href'), window.location.href).href : null;

            out.push({
              caseNumber, address, city, zip, county,
              lat, lng, price,
              beds: bedMatch ? parseInt(bedMatch[1]) : null,
              baths: bathMatch ? parseFloat(bathMatch[1]) : null,
              sqft: sqftMatch ? parseInt(sqftMatch[1].replace(/,/g, '')) : null,
              sourceUrl,
            });
          }
          return out;
        });

        console.log(`[HUD] ${cfg.name} extracted ${listings.length} listings from DOM`);

        for (const l of listings) {
          if (!l.address || l.address.length < 5) continue;

          // Filter by county if HUD tagged it; otherwise trust the city/state search
          if (l.county && l.county.toLowerCase() !== cfg.name.toLowerCase()) continue;

          const cleanAddress = l.address
            .split(/\r?\n/)[0]
            .replace(/,\s*(TX|Texas).*/i, '')
            .trim()
            .substring(0, 200);

          results.push({
            address:       cleanAddress,
            city:          l.city || cfg.cities[0],
            zip_code:      l.zip || null,
            county:        cfg.name,
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
            source_url:    l.sourceUrl || url,
            case_number:   l.caseNumber,
            description:   'HUD Home — sold as-is. Contact listing broker for showing instructions. ' +
                           'FHA financing may be available with escrow repair addendum.',
          });
        }
      } catch (e) {
        console.error(`[HUD] ${cfg.name} error:`, e.message);
      } finally {
        await page.close().catch(() => {});
      }
    }

    console.log(`\n[HUD] Total across all counties: ${results.length}`);
  } catch (err) {
    console.error('[HUD] Fatal error:', err.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  return results;
}

module.exports = { scrapeHUDHomes };
