/**
 * County Clerk Foreclosure Notice Scraper — multi-county.
 *
 * Texas county clerks publish Notice of Trustee Sale documents (PDFs).
 * The exact URL pattern varies by county. This scraper:
 *   1. Loads the county clerk index page
 *   2. Finds linked PDFs
 *   3. Downloads + parses each PDF for Notice of Trustee Sale entries
 *   4. Extracts property address, sale date, case#, trustee, lender
 *
 * Dallas County: monthly folder structure
 *   https://www.dallascounty.org/.../foreclosure/<Month>/<City>_<N>.pdf
 *
 * Travis County: single index page with linked notice PDFs
 *   https://countyclerk.traviscountytx.gov/foreclosure-notices.html
 */
const axios = require('axios');
const cheerio = require('cheerio');
const pdfParse = require('pdf-parse');
const COUNTIES = require('./counties');

const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];

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

async function scrapeCountyClerkForeclosures() {
  const allResults = [];
  const upcomingTuesday = nextFirstTuesdays(1)[0];
  const upcomingMonth = MONTH_NAMES[new Date(upcomingTuesday + 'T12:00:00').getMonth()];

  for (const cfg of Object.values(COUNTIES)) {
    if (!cfg.clerk?.indexUrl) continue;
    console.log(`\n[${cfg.name}-Clerk] === Fetching index ===`);
    try {
      const countyResults = await scrapeOneCounty(cfg, upcomingMonth, upcomingTuesday);
      allResults.push(...countyResults);
    } catch (e) {
      console.error(`[${cfg.name}-Clerk] Error:`, e.message);
    }
  }

  // De-duplicate by source_id across counties
  const seen = new Set();
  const dedup = [];
  for (const r of allResults) {
    if (seen.has(r.source_id)) continue;
    seen.add(r.source_id);
    dedup.push(r);
  }
  console.log(`\n[County-Clerk] Total unique notices: ${dedup.length}`);
  return dedup;
}

async function scrapeOneCounty(cfg, upcomingMonth, upcomingTuesday) {
  const results = [];
  const clerk   = cfg.clerk;

  let indexHtml;
  try {
    const res = await axios.get(clerk.indexUrl, {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/127.0.0.0 Safari/537.36',
      },
    });
    indexHtml = res.data;
  } catch (e) {
    console.error(`[${cfg.name}-Clerk] Index fetch failed: ${e.message}`);
    return results;
  }

  const $ = cheerio.load(indexHtml);
  const pdfLinks = [];

  // Find all PDF anchors
  $('a').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    if (!href.toLowerCase().endsWith('.pdf')) return;
    // Filter to foreclosure-related PDFs
    if (clerk.pdfHrefIncludes && !href.toLowerCase().includes(clerk.pdfHrefIncludes.toLowerCase())) return;

    // Prefer current month's folder if the URL structure has a month
    let priority = 0;
    if (href.includes(`/${upcomingMonth}/`)) priority = 1;

    const fullUrl = href.startsWith('http')
      ? href
      : (href.startsWith('/')
          ? `${clerk.pdfHostBase}${href}`
          : `${clerk.pdfHostBase}/${href}`);

    pdfLinks.push({
      url:      fullUrl,
      filename: href.split('/').pop(),
      priority,
    });
  });

  console.log(`[${cfg.name}-Clerk] Found ${pdfLinks.length} PDF links`);
  if (pdfLinks.length === 0) return results;

  // Prefer this-month PDFs; cap at 30 to keep scrapes fast
  pdfLinks.sort((a, b) => b.priority - a.priority);
  const toFetch = pdfLinks.slice(0, 30);

  for (const pdf of toFetch) {
    try {
      console.log(`[${cfg.name}-Clerk] Parsing ${pdf.filename}...`);
      const pdfRes = await axios.get(pdf.url, {
        responseType: 'arraybuffer',
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/127.0.0.0 Safari/537.36',
        },
      });
      const data   = await pdfParse(Buffer.from(pdfRes.data));
      const text   = data.text || '';

      const notices = parseNoticesFromText(text, cfg.name);
      console.log(`[${cfg.name}-Clerk] ${pdf.filename}: ${notices.length} notices`);

      for (const n of notices) {
        results.push({
          address:       n.address.substring(0, 200),
          city:          n.city || extractCityFromFilename(pdf.filename, cfg) || cfg.cities[0],
          zip_code:      n.zip || null,
          county:        cfg.name,
          property_type: 'SFR',
          sale_type:     'Foreclosure',
          status:        'Active',
          auction_date:  n.saleDate || upcomingTuesday,
          list_date:     new Date().toISOString().split('T')[0],
          source:        `${cfg.name} County Clerk`,
          source_id:     n.caseNumber
            ? `${cfg.name.toUpperCase()}-CC-${n.caseNumber}`
            : `${cfg.name.toUpperCase()}-CC-${(n.address.replace(/\W+/g,'-') + '-' + (n.saleDate || upcomingTuesday)).substring(0, 80)}`,
          source_url:    pdf.url,
          case_number:   n.caseNumber || null,
          trustee:       n.trustee || null,
          lender:        n.lender || null,
          description:   `Notice of Trustee Sale — ${cfg.name} County. Source PDF: ${pdf.filename}. ` +
                         `Cash-only auction; verify time/location at county courthouse.`,
        });
      }
    } catch (e) {
      console.error(`[${cfg.name}-Clerk] PDF parse error for ${pdf.filename}: ${e.message.split('\n')[0]}`);
    }
  }

  return results;
}

/**
 * Parse Notice of Trustee Sale text into structured records.
 *
 * Texas notices include:
 *   - "Notice of [Substitute] Trustee's Sale" header
 *   - Property Address
 *   - Trustee name + address
 *   - Date of Sale (YYYY or MM/DD/YYYY)
 *   - County: <countyName>
 *   - Original Mortgagor / Borrower name
 *   - Beneficiary / Mortgagee
 */
function parseNoticesFromText(text, countyName) {
  const notices = [];
  const noticeBlocks = text.split(/(?=NOTICE OF (?:SUBSTITUTE )?TRUSTEE'?S SALE)/i)
                           .filter(b => b.length > 200);

  for (const block of noticeBlocks) {
    let address = null, city = null, zip = null;

    const fullAddrRe = /(\d{1,6}\s+(?:[NSEW]\.?\s+)?[A-Z][\w.\s]{2,40}?(?:DR|DRIVE|ST|STREET|AVE|AVENUE|LN|LANE|RD|ROAD|BLVD|BOULEVARD|CT|COURT|CIR|CIRCLE|PL|PLACE|WAY|PARKWAY|PKWY|TRL|TRAIL|TER|TERRACE|HWY|HIGHWAY|SQ|SQUARE)\.?)\,?\s+([A-Z][A-Za-z\s.]+?),?\s+(?:TX|Texas)\.?\s*(\d{5})/i;
    const fullM = block.match(fullAddrRe);
    if (fullM) {
      address = fullM[1].replace(/\s+/g, ' ').trim();
      city    = fullM[2].replace(/\s+/g, ' ').trim();
      zip     = fullM[3];
    }

    if (!address) {
      const m1 = block.match(/(?:Property Address|Address of Property|Mortgaged Property Address|Property Location)[:\s]+([^\n]+(?:\n[^\n]{3,80})?)/i);
      if (m1) {
        const raw = m1[1].replace(/\s+/g, ' ').trim();
        const m2  = raw.match(/^(.+?),\s+([A-Z][A-Za-z\s.]+),?\s+(?:TX|Texas)\.?\s+(\d{5})/i);
        if (m2) { address = m2[1].trim(); city = m2[2].trim(); zip = m2[3]; }
        else { address = raw.split(',')[0].trim(); }
      }
    }

    if (!address || address.length < 5) continue;
    if (/^\d{4,}\s*$/.test(address) || (address.match(/\d/g) || []).length > address.length * 0.6) continue;

    let saleDate = null;
    const dateMatch = block.match(/(?:Date of Sale|Sale Date)[:\s]+(\w+\s+\d+,?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4})/i)
                  || block.match(/(?:on|will be held).{0,80}?(\d{1,2}\/\d{1,2}\/\d{4})/i);
    if (dateMatch) {
      try {
        const d = new Date(dateMatch[1]);
        if (!isNaN(d)) saleDate = d.toISOString().split('T')[0];
      } catch {}
    }

    let caseNumber = null;
    const caseMatch = block.match(/(?:Case|Instrument|File|TS)\s*(?:Number|No\.?|#)\s*[:\s]+([A-Z0-9-]{4,30})/i);
    if (caseMatch) caseNumber = caseMatch[1].trim();

    let trustee = null;
    const trusteeMatch = block.match(/(?:Substitute Trustee|Trustee)[:\s]+([A-Z][A-Z\s,]+?)(?:\n|whose|appointed|c\/o)/);
    if (trusteeMatch) trustee = trusteeMatch[1].trim().substring(0, 100);

    let lender = null;
    const lenderMatch = block.match(/(?:Beneficiary|Mortgagee|Original Mortgagee|Lender)[:\s]+([A-Z][A-Z\s,&]+?)(?:\n|whose|c\/o)/);
    if (lenderMatch) lender = lenderMatch[1].trim().substring(0, 100);

    notices.push({ address, city, zip, saleDate, caseNumber, trustee, lender });
  }

  return notices;
}

function extractCityFromFilename(fn, cfg) {
  if (!fn) return null;
  const m = fn.replace(/\.pdf$/i, '').replace(/_\d+$/, '').replace(/-/g, ' ').trim();
  if (!m) return null;
  // Match against this county's known cities (case-insensitive)
  const match = cfg.cities.find(c => c.toLowerCase() === m.toLowerCase());
  return match || m;
}

module.exports = { scrapeCountyClerkForeclosures, nextFirstTuesdays };
