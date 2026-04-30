/**
 * Xome.com Scraper — Dallas County, TX
 *
 * Xome lists bank-owned (REO) and pre-foreclosure auction properties.
 * The page serves HTML with <address> tags containing property links.
 * URL pattern: /auctions/{street-slug}-{city}-{state}-{zip}-{propId}
 */
const cheerio = require('cheerio');
const { launchBrowser, newPage } = require('./browser');

const BASE_URL   = 'https://www.xome.com/auctions/listing/TX/Dallas';
const HOST       = 'https://www.xome.com';
const MAX_PAGES  = 3;

async function scrapeXome() {
  const results = [];
  const seenIds = new Set();
  let browser;

  try {
    browser = await launchBrowser();

    for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
      const url  = pageNum === 1 ? BASE_URL : `${BASE_URL}?pg=${pageNum}`;
      const page = await newPage(browser);

      console.log(`[Xome] Page ${pageNum}: ${url}`);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
      await page.humanDelay();

      const title = await page.title();
      console.log(`[Xome] p${pageNum} title: ${title}`);

      const html = await page.content();
      await page.close().catch(() => {});

      const $ = cheerio.load(html);

      // Count cards on this page
      const addressLinks = $('address a.address-linktext, address a[href*="/auctions/"]');
      console.log(`[Xome] p${pageNum} address links found: ${addressLinks.length}`);

      if (addressLinks.length === 0) {
        // Try to find any property link patterns
        const allLinks = $('a[href*="/auctions/"][href*="-TX-"]');
        console.log(`[Xome] p${pageNum} TX links: ${allLinks.length}`);
        if (allLinks.length === 0) {
          console.log(`[Xome] No properties on page ${pageNum}, stopping`);
          break;
        }
        // Use these links as fallback
        allLinks.each((_, el) => processLink($, el, results, seenIds));
      } else {
        addressLinks.each((_, el) => processLink($, el, results, seenIds));
      }

      // Check for next page
      const nextBtn = $('a[rel="next"], a.pagination-next, [class*="next-page"], li.next a');
      if (nextBtn.length === 0) {
        console.log(`[Xome] No next page button found, stopping at page ${pageNum}`);
        break;
      }
    }

    console.log(`[Xome] Total: ${results.length} properties`);
  } catch (err) {
    console.error('[Xome] Scrape error:', err.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  return results;
}

function processLink($, el, results, seenIds) {
  const href = $(el).attr('href') || '';
  if (!href || !href.includes('/auctions/')) return;

  // Parse URL: /auctions/3883-Turtle-Crk-Blvd-Unit1408-Dallas-TX-75219-411847186
  const slugMatch = href.match(/\/auctions\/(.+?)-TX-(\d{5})-(\d+)$/i);
  if (!slugMatch) return;

  const slug     = slugMatch[1]; // e.g. "3883-Turtle-Crk-Blvd-Unit1408-Dallas"
  const zip      = slugMatch[2]; // e.g. "75219"
  const propId   = slugMatch[3]; // e.g. "411847186"

  if (seenIds.has(propId)) return;
  seenIds.add(propId);

  // Split slug into address + city
  // Pattern: street-address-CITY (city is usually last word(s) before TX)
  const { address, city } = parseSlug(slug);

  // Find the parent card to extract price, beds, baths, date
  const card = $(el).closest('[class*="property"], [class*="listing"], [class*="auction"], article, li, .card, .tile')
    || $(el).parents('div').eq(3);

  const cardText = card.text() || $(el).parents('div').eq(4).text() || '';

  // Price
  const priceMatch = cardText.match(/\$[\d,]+/);
  const price = priceMatch ? parseFloat(priceMatch[0].replace(/[^0-9.]/g, '')) : null;

  // Beds/Baths
  const bedsMatch  = cardText.match(/(\d+)\s*(?:bed|bd|br)/i);
  const bathsMatch = cardText.match(/(\d+(?:\.\d)?)\s*(?:bath|ba)/i);
  const sqftMatch  = cardText.match(/([\d,]+)\s*(?:sq\.?\s*ft|sqft)/i);
  const beds  = bedsMatch  ? parseInt(bedsMatch[1])  : null;
  const baths = bathsMatch ? parseFloat(bathsMatch[1]) : null;
  const sqft  = sqftMatch  ? parseInt(sqftMatch[1].replace(',', '')) : null;

  // Auction date
  const dateEl = card.find('.auction-date, [class*="auction-date"], [class*="date"]').first();
  const dateText = dateEl.text().trim();
  const auctionDate = fmtDate(dateText);

  // Sale type from status
  const statusEl = card.find('.auction-status, [class*="status"]').first();
  const statusText = (statusEl.text() || cardText).toLowerCase();
  const saleType = statusText.includes('reo') || statusText.includes('bank') ? 'REO'
    : statusText.includes('short') ? 'Short Sale'
    : 'Foreclosure';

  if (!address || address.length < 3) return;

  results.push({
    address,
    city:          city || 'Dallas',
    zip_code:      zip  || null,
    county:        'Dallas',
    price,
    bedrooms:      beds,
    bathrooms:     baths,
    sqft,
    property_type: 'SFR',
    sale_type:     saleType,
    status:        'Active',
    auction_date:  auctionDate,
    list_date:     new Date().toISOString().split('T')[0],
    source:        'Xome',
    source_id:     `XOME-${propId}`,
    source_url:    href.startsWith('http') ? href : `${HOST}${href}`,
    description:   `Xome auction property in ${city || 'Dallas'}, TX. ${saleType}. Register to bid at xome.com.`,
  });
}

// Known multi-word Dallas-area cities
const MULTI_CITIES = [
  'Grand Prairie', 'Balch Springs', 'Oak Leaf', 'Farmers Branch',
  'Cedar Hill', 'Glenn Heights', 'Cockrell Hill', 'University Park',
  'Highland Park',
];

function parseSlug(slug) {
  // slug: "3883-Turtle-Crk-Blvd-Unit1408-Dallas" or "618-Royal-Ave-Grand-Prairie"
  const parts = slug.split('-');

  // Try multi-word cities first
  for (const mc of MULTI_CITIES) {
    const mcParts = mc.toLowerCase().split(' ');
    const mcSlug  = mcParts.join('-');
    const noState = slug.toLowerCase();
    if (noState.endsWith('-' + mcSlug)) {
      const city    = mc;
      const addrParts = parts.slice(0, parts.length - mcParts.length);
      return {
        address: toTitleCase(addrParts.join(' ')),
        city,
      };
    }
  }

  // Single-word city = last word
  const city    = toTitleCase(parts[parts.length - 1]);
  const address = toTitleCase(parts.slice(0, -1).join(' '));
  return { address, city };
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

module.exports = { scrapeXome };
