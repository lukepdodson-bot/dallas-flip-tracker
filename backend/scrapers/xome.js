/**
 * Xome.com Scraper — multi-county.
 *
 * Xome lists bank-owned (REO) and pre-foreclosure auction properties.
 * URL pattern: /auctions/listing/TX/{County}
 * Property links: /auctions/{street-slug}-{city}-{state}-{zip}-{propId}
 */
const cheerio = require('cheerio');
const { launchBrowser, newPage } = require('./browser');
const COUNTIES = require('./counties');

const HOST       = 'https://www.xome.com';
const MAX_PAGES  = 3;

async function scrapeXome() {
  const results = [];
  const seenIds = new Set();
  let browser;

  try {
    browser = await launchBrowser();

    for (const cfg of Object.values(COUNTIES)) {
      const base = `${HOST}/auctions/listing/TX/${cfg.xomeSlug}`;
      console.log(`\n[Xome] === ${cfg.name} County ===`);

      for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
        const url  = pageNum === 1 ? base : `${base}?pg=${pageNum}`;
        const page = await newPage(browser);

        console.log(`[Xome] ${cfg.name} p${pageNum}: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        await page.humanDelay();

        const title = await page.title();
        console.log(`[Xome] ${cfg.name} p${pageNum} title: ${title}`);

        const html = await page.content();
        await page.close().catch(() => {});

        const $ = cheerio.load(html);

        const addressLinks = $('address a.address-linktext, address a[href*="/auctions/"]');
        let processedAny = false;
        if (addressLinks.length > 0) {
          addressLinks.each((_, el) => {
            const added = processLink($, el, results, seenIds, cfg);
            if (added) processedAny = true;
          });
        } else {
          const allLinks = $('a[href*="/auctions/"][href*="-TX-"]');
          allLinks.each((_, el) => {
            const added = processLink($, el, results, seenIds, cfg);
            if (added) processedAny = true;
          });
        }

        if (!processedAny) {
          console.log(`[Xome] ${cfg.name} no properties on p${pageNum}, stopping`);
          break;
        }
      }
    }

    console.log(`\n[Xome] Total across all counties: ${results.length}`);
  } catch (err) {
    console.error('[Xome] Scrape error:', err.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  return results;
}

function processLink($, el, results, seenIds, cfg) {
  const href = $(el).attr('href') || '';
  if (!href || !href.includes('/auctions/')) return false;

  const slugMatch = href.match(/\/auctions\/(.+?)-TX-(\d{5})-(\d+)$/i);
  if (!slugMatch) return false;

  const slug   = slugMatch[1];
  const zip    = slugMatch[2];
  const propId = slugMatch[3];

  if (seenIds.has(propId)) return false;
  seenIds.add(propId);

  const { address, city } = parseSlug(slug, cfg);

  const card = $(el).closest('[class*="property"], [class*="listing"], [class*="auction"], article, li, .card, .tile')
    || $(el).parents('div').eq(3);

  const cardText = card.text() || $(el).parents('div').eq(4).text() || '';

  const priceMatch = cardText.match(/\$[\d,]+/);
  const price = priceMatch ? parseFloat(priceMatch[0].replace(/[^0-9.]/g, '')) : null;

  const bedsMatch  = cardText.match(/(\d+)\s*(?:bed|bd|br)/i);
  const bathsMatch = cardText.match(/(\d+(?:\.\d)?)\s*(?:bath|ba)/i);
  const sqftMatch  = cardText.match(/([\d,]+)\s*(?:sq\.?\s*ft|sqft)/i);
  const beds  = bedsMatch  ? parseInt(bedsMatch[1])  : null;
  const baths = bathsMatch ? parseFloat(bathsMatch[1]) : null;
  const sqft  = sqftMatch  ? parseInt(sqftMatch[1].replace(',', '')) : null;

  const dateEl = card.find('.auction-date, [class*="auction-date"], [class*="date"]').first();
  const dateText = dateEl.text().trim();
  const auctionDate = fmtDate(dateText);

  const statusEl = card.find('.auction-status, [class*="status"]').first();
  const statusText = (statusEl.text() || cardText).toLowerCase();
  const saleType = statusText.includes('reo') || statusText.includes('bank') ? 'REO'
    : statusText.includes('short') ? 'Short Sale'
    : 'Foreclosure';

  if (!address || address.length < 3) return false;

  results.push({
    address,
    city:          city || (cfg.cities[0] || 'Dallas'),
    zip_code:      zip  || null,
    county:        cfg.name,
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
    description:   `Xome auction property in ${city || cfg.cities[0]}, TX. ${saleType}. Register to bid at xome.com.`,
  });
  return true;
}

function parseSlug(slug, cfg) {
  const parts = slug.split('-');
  const slugLow = slug.toLowerCase();

  // Try multi-word cities first
  for (const mc of cfg.cities) {
    const mcParts = mc.toLowerCase().split(/\s+/);
    if (mcParts.length < 2) continue;
    const mcSlug = mcParts.join('-');
    if (slugLow.endsWith('-' + mcSlug)) {
      const addrParts = parts.slice(0, parts.length - mcParts.length);
      return {
        address: toTitleCase(addrParts.join(' ')),
        city:    mc,
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
