/**
 * Dallas County Clerk - Notice of Trustee Sale Scraper
 *
 * In Texas, foreclosures are non-judicial. Lenders post a "Notice of Trustee Sale"
 * with the county clerk at least 21 days before the auction. Auctions happen on the
 * first Tuesday of each month at the Dallas County courthouse (600 Commerce St).
 *
 * This scraper targets the Dallas County Clerk's public foreclosure notice records.
 * URL: https://www.dallascounty.org/departments/dallascad/
 *
 * NOTE: Dallas County Clerk uses a document management system. Foreclosure notices
 * (Notice of Trustee Sale) are indexed under instrument type "NTS" in their records.
 * The scraper uses their public records search portal.
 */
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');

// Next first Tuesdays of the month
function getNextFirstTuesdays(count = 6) {
  const results = [];
  const now = new Date();
  let month = now.getMonth();
  let year = now.getFullYear();

  for (let i = 0; i < count + 2; i++) {
    const d = new Date(year, month, 1);
    // Find first Tuesday
    while (d.getDay() !== 2) d.setDate(d.getDate() + 1);
    if (d > now) results.push(d.toISOString().split('T')[0]);
    if (results.length >= count) break;
    month++;
    if (month > 11) { month = 0; year++; }
  }
  return results;
}

async function scrapeDallasCountyForeclosures() {
  const results = [];

  try {
    // Dallas County Clerk public records search
    // Instrument type: NTS (Notice of Trustee Sale)
    // This endpoint may require adaptation based on the clerk's current portal
    const baseUrl = 'https://www.dallascounty.org/departments/clerk/';

    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    try {
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');

      // Navigate to foreclosure search - adjust URL based on current clerk portal
      await page.goto('https://www.dallascounty.org/departments/clerk/foreclosures/', {
        waitUntil: 'networkidle2',
        timeout: 20000,
      });

      const html = await page.content();
      const $ = cheerio.load(html);

      // Parse table rows - structure varies by clerk portal version
      $('table tr, .foreclosure-listing').each((i, el) => {
        const cols = $(el).find('td');
        if (cols.length < 3) return;

        const caseNum = $(cols[0]).text().trim();
        const address = $(cols[1]).text().trim();
        const trustor = $(cols[2]).text().trim();
        const trustee = $(cols[3])?.text().trim();
        const saleDate = $(cols[4])?.text().trim();
        const amount = parseFloat($(cols[5])?.text().replace(/[^0-9.]/g, '')) || null;

        if (address && address.length > 5) {
          // Extract zip from address if present
          const zipMatch = address.match(/\b(75\d{3})\b/);
          results.push({
            address: address.replace(/,?\s*(Dallas|TX|75\d{3}).*/i, '').trim(),
            city: 'Dallas',
            zip_code: zipMatch ? zipMatch[1] : null,
            county: 'Dallas',
            price: amount,
            property_type: 'SFR',
            sale_type: 'Foreclosure',
            status: 'Active',
            auction_date: saleDate ? parseDate(saleDate) : getNextFirstTuesdays(1)[0],
            list_date: new Date().toISOString().split('T')[0],
            source: 'Dallas County Clerk',
            source_id: caseNum || `DC-${Date.now()}-${i}`,
            case_number: caseNum,
            trustee,
            description: `Foreclosure - Trustor: ${trustor}. Auction at Dallas County Courthouse, 600 Commerce St, Dallas TX. Cash only at auction.`,
          });
        }
      });

    } finally {
      await browser.close();
    }

    console.log(`[Dallas County Clerk] Found ${results.length} foreclosure notices`);
  } catch (err) {
    console.error('[Dallas County Clerk] Scrape error:', err.message);
    // Non-fatal - return what we have
  }

  return results;
}

function parseDate(str) {
  try {
    const d = new Date(str);
    if (!isNaN(d)) return d.toISOString().split('T')[0];
  } catch {}
  return null;
}

module.exports = { scrapeDallasCountyForeclosures, getNextFirstTuesdays };
