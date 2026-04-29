/**
 * Dallas County Foreclosure Scraper
 *
 * Sources two types of Dallas County distressed properties:
 *
 * 1. Bid4Assets — Dallas County holds its annual tax deed sales here.
 *    URL: https://www.bid4assets.com/txdallas
 *
 * 2. BDFTE (Barrett Daffin Frappier Turner & Engel) — one of the largest
 *    Texas foreclosure trustees; they publish upcoming first-Tuesday auction
 *    lists on their portal for each Texas county.
 *    URL: https://www.logs.com/ (Texas Foreclosure Monthly Sale lists)
 *
 * Both are rendered in the browser so we use puppeteer stealth.
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

async function scrapeDallasCountyForeclosures() {
  const results = [];
  const upcomingTuesday = nextFirstTuesdays(1)[0];
  let browser;

  try {
    browser = await launchBrowser();

    // ── Source 1: Bid4Assets Dallas County Tax Sales ──────────────────────────
    try {
      const page = await newPage(browser);
      console.log('[Bid4Assets] Navigating…');
      await page.goto('https://www.bid4assets.com/txdallas', {
        waitUntil: 'networkidle2',
        timeout: 60000,
      });
      await page.humanDelay();

      // Try to intercept any JSON data response
      const html = await page.content();
      const $    = cheerio.load(html);

      const cards = $('[class*="auction-item"], [class*="property-item"], [class*="listing"], .auc-item, .property-card, article');
      console.log(`[Bid4Assets] Found ${cards.length} cards`);

      cards.each((_, card) => {
        const text     = $(card).text();
        const address  = $(card).find('[class*="address" i], [class*="street" i], h2, h3').first().text().trim();
        const priceEl  = $(card).find('[class*="price" i], [class*="bid" i], [class*="amount" i]').first().text();
        const price    = parseFloat(priceEl.replace(/[^0-9.]/g, '')) || null;
        const href     = $(card).find('a').first().attr('href');
        const dateEl   = $(card).find('[class*="date" i], [class*="end" i]').first().text();
        const auctionDate = fmtDate(dateEl) || upcomingTuesday;

        if (!address || address.length < 5) return;

        results.push({
          address:      address.replace(/,?\s*(TX|Texas).*/i, '').trim(),
          city:         extractCity(text) || 'Dallas',
          county:       'Dallas',
          price,
          property_type: 'SFR',
          sale_type:    'Tax Sale',
          status:       'Active',
          auction_date: auctionDate,
          list_date:    new Date().toISOString().split('T')[0],
          source:       'Dallas County Tax Sale',
          source_id:    `BID4-${address.replace(/\W+/g, '-')}`,
          source_url:   href
            ? (href.startsWith('http') ? href : `https://www.bid4assets.com${href}`)
            : 'https://www.bid4assets.com/txdallas',
          description:
            'Dallas County tax deed sale via Bid4Assets. ' +
            'Buyer responsible for any remaining liens. Online bidding.',
        });
      });
      await page.close();
    } catch (e) {
      console.error('[Bid4Assets] Error:', e.message);
    }

    // ── Source 2: logs.com — Texas Trustee Sale Monthly Lists (BDFTE) ────────
    try {
      const page = await newPage(browser);
      console.log('[LOGS.com] Navigating to Texas foreclosure list…');

      // logs.com is the Trustee Sale publication portal for major TX foreclosure trustees
      await page.goto('https://www.logs.com/texas/dallas/', {
        waitUntil: 'networkidle2',
        timeout: 60000,
      });
      await page.humanDelay();

      const html = await page.content();
      const $    = cheerio.load(html);

      // The page lists properties with case numbers, addresses, trustee info
      const rows = $('table tr, .foreclosure-item, [class*="notice"], li[class*="item"]');
      console.log(`[LOGS.com] Found ${rows.length} rows`);

      rows.each((i, row) => {
        if (i === 0) return;
        const cells   = $(row).find('td');
        const text    = $(row).text();
        if (text.length < 10) return;

        let address, caseNum, trustee, saleDate;

        if (cells.length >= 3) {
          caseNum  = $(cells[0]).text().trim();
          address  = $(cells[1]).text().trim();
          trustee  = $(cells[2]).text().trim();
          saleDate = $(cells[3])?.text().trim();
        } else {
          address = $(row).find('[class*="address" i]').text().trim() || text.trim();
        }

        if (!address || address.length < 5) return;
        if (!text.toLowerCase().includes('dallas')) return;

        const href = $(row).find('a').first().attr('href');
        results.push({
          address:      address.replace(/,?\s*(TX|Dallas|75\d{3}).*/i, '').trim(),
          city:         extractCity(text) || 'Dallas',
          county:       'Dallas',
          property_type: 'SFR',
          sale_type:    'Foreclosure',
          status:       'Active',
          auction_date: fmtDate(saleDate) || upcomingTuesday,
          list_date:    new Date().toISOString().split('T')[0],
          source:       'Dallas County Clerk',
          source_id:    caseNum || `LOGS-${address.replace(/\W+/g, '-')}`,
          source_url:   href
            ? (href.startsWith('http') ? href : `https://www.logs.com${href}`)
            : 'https://www.logs.com/texas/dallas/',
          case_number:  caseNum || null,
          trustee:      trustee || null,
          description:
            `Notice of Trustee Sale — Dallas County. ` +
            `Auction at Dallas County Courthouse, 600 Commerce St. Cash only.`,
        });
      });
      await page.close();
    } catch (e) {
      console.error('[LOGS.com] Error:', e.message);
    }

    console.log(`[Dallas County] Total: ${results.length} properties`);
  } catch (err) {
    console.error('[Dallas County] Fatal error:', err.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  return results;
}

function extractCity(text) {
  const cities = [
    'Dallas','Irving','Garland','Mesquite','DeSoto','Lancaster','Rowlett',
    'Grand Prairie','Duncanville','Balch Springs','Hutchins','Wilmer',
    'Seagoville','Sunnyvale','Sachse','Farmers Branch','Richardson','Carrollton',
  ];
  for (const c of cities) {
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
