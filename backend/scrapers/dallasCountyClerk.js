/**
 * Dallas County Clerk — Foreclosure Notices
 *
 * Dallas County Clerk publishes Notice of Trustee Sale documents as monthly
 * PDF files on:
 *   https://www.dallascounty.org/government/county-clerk/recording/foreclosures.php
 *
 * URL pattern: /department/countyclerk/media/foreclosure/<Month>/<City>_<N>.pdf
 *
 * We download each PDF for the upcoming first-Tuesday auction month and parse
 * Notice of Trustee Sale text to extract: address, case#, sale date, trustee.
 */
const axios = require('axios');
const cheerio = require('cheerio');
const pdfParse = require('pdf-parse');

const INDEX_URL = 'https://www.dallascounty.org/government/county-clerk/recording/foreclosures.php';

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

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

async function scrapeDallasCountyForeclosures() {
  const results = [];
  const upcomingTuesday = nextFirstTuesdays(1)[0];

  // The upcoming first-Tuesday's month tells us which folder to look in
  const upcomingMonth = MONTH_NAMES[new Date(upcomingTuesday + 'T12:00:00').getMonth()];

  try {
    // ── Step 1: Get the index page and extract PDF URLs ────────────────────────
    console.log(`[DCC] Fetching index for ${upcomingMonth}…`);
    const indexRes = await axios.get(INDEX_URL, {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/127.0.0.0 Safari/537.36',
      },
    });
    const $ = cheerio.load(indexRes.data);

    const pdfLinks = [];
    $('a[href*="/foreclosure/"]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href || !href.endsWith('.pdf')) return;
      // We only want PDFs in the upcoming month folder
      if (!href.includes(`/${upcomingMonth}/`)) return;
      const fullUrl = href.startsWith('http') ? href : `https://www.dallascounty.org${href}`;
      pdfLinks.push({
        url: fullUrl,
        filename: href.split('/').pop(),
      });
    });

    console.log(`[DCC] Found ${pdfLinks.length} PDF files for ${upcomingMonth}`);

    if (pdfLinks.length === 0) {
      // Fall back: take whatever month has PDFs
      $('a[href*="/foreclosure/"]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href || !href.endsWith('.pdf')) return;
        const fullUrl = href.startsWith('http') ? href : `https://www.dallascounty.org${href}`;
        pdfLinks.push({ url: fullUrl, filename: href.split('/').pop() });
      });
      pdfLinks.splice(15); // limit
      console.log(`[DCC] Using fallback: ${pdfLinks.length} PDFs across all months`);
    }

    // ── Step 2: Download + parse each PDF ──────────────────────────────────────
    for (const pdf of pdfLinks.slice(0, 30)) {
      try {
        console.log(`[DCC] Parsing ${pdf.filename}...`);
        const pdfRes = await axios.get(pdf.url, { responseType: 'arraybuffer', timeout: 30000 });
        const data   = await pdfParse(Buffer.from(pdfRes.data));
        const text   = data.text || '';

        const notices = parseNoticesFromText(text, pdf.filename);
        console.log(`[DCC] ${pdf.filename}: ${notices.length} notices`);

        for (const n of notices) {
          results.push({
            address:       n.address.substring(0, 200),
            city:          n.city || extractCityFromFilename(pdf.filename) || 'Dallas',
            zip_code:      n.zip || null,
            county:        'Dallas',
            property_type: 'SFR',
            sale_type:     'Foreclosure',
            status:        'Active',
            auction_date:  n.saleDate || upcomingTuesday,
            list_date:     new Date().toISOString().split('T')[0],
            source:        'Dallas County Clerk',
            source_id:     n.caseNumber
              ? `DCC-${n.caseNumber}`
              : `DCC-${(n.address.replace(/\W+/g,'-') + '-' + (n.saleDate || upcomingTuesday)).substring(0, 80)}`,
            source_url:    pdf.url,
            case_number:   n.caseNumber || null,
            trustee:       n.trustee || null,
            lender:        n.lender || null,
            description:   `Notice of Trustee Sale — Dallas County. Source PDF: ${pdf.filename}. ` +
                           `Auction at Dallas County Courthouse, 600 Commerce St. Cash only.`,
          });
        }
      } catch (e) {
        console.error(`[DCC] PDF parse error for ${pdf.filename}: ${e.message.split('\n')[0]}`);
      }
    }

    // De-duplicate by source_id
    const seen = new Set();
    const dedup = [];
    for (const r of results) {
      if (seen.has(r.source_id)) continue;
      seen.add(r.source_id);
      dedup.push(r);
    }
    console.log(`[DCC] Total: ${dedup.length} unique notices`);
    return dedup;
  } catch (err) {
    console.error('[DCC] Scrape error:', err.message);
    return [];
  }
}

/**
 * Parse Notice of Trustee Sale text into structured records.
 *
 * Texas notices typically include:
 *   - "Notice of [Substitute] Trustee's Sale" header
 *   - Property Address
 *   - Trustee name + address
 *   - Date of Sale (YYYY or MM/DD/YYYY)
 *   - County: Dallas
 *   - Original Mortgagor / Borrower name
 *   - Beneficiary / Mortgagee
 */
function parseNoticesFromText(text, filename) {
  const notices = [];

  // Split text into individual notices. Common delimiters:
  //   - "NOTICE OF [SUBSTITUTE] TRUSTEE'S SALE"
  //   - Multiple consecutive newlines + page break
  const noticeBlocks = text.split(/(?=NOTICE OF (?:SUBSTITUTE )?TRUSTEE'?S SALE)/i)
                           .filter(b => b.length > 200);

  for (const block of noticeBlocks) {
    // Property address — usually under "Property Address:" or as a standalone line
    let address = null, city = null, zip = null;

    // Strict pattern: full street+city+TX+zip line. Most reliable.
    const fullAddrRe = /(\d{1,6}\s+(?:[NSEW]\.?\s+)?[A-Z][\w.\s]{2,40}?(?:DR|DRIVE|ST|STREET|AVE|AVENUE|LN|LANE|RD|ROAD|BLVD|BOULEVARD|CT|COURT|CIR|CIRCLE|PL|PLACE|WAY|PARKWAY|PKWY|TRL|TRAIL|TER|TERRACE|HWY|HIGHWAY|SQ|SQUARE)\.?)\,?\s+([A-Z][A-Za-z\s.]+?),?\s+(?:TX|Texas)\.?\s*(\d{5})/i;
    const fullM = block.match(fullAddrRe);
    if (fullM) {
      address = fullM[1].replace(/\s+/g, ' ').trim();
      city    = fullM[2].replace(/\s+/g, ' ').trim();
      zip     = fullM[3];
    }

    // Fallback: labeled "Property Address:" line
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
    // Reject if address is mostly digits (PDF page numbers/instrument numbers got grabbed)
    if (/^\d{4,}\s*$/.test(address) || (address.match(/\d/g) || []).length > address.length * 0.6) continue;

    // Sale date — in MM/DD/YYYY or "Date of Sale: ..."
    let saleDate = null;
    const dateMatch = block.match(/(?:Date of Sale|Sale Date)[:\s]+(\w+\s+\d+,?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4})/i)
                  || block.match(/(?:on|will be held).{0,80}?(\d{1,2}\/\d{1,2}\/\d{4})/i);
    if (dateMatch) {
      try {
        const d = new Date(dateMatch[1]);
        if (!isNaN(d)) saleDate = d.toISOString().split('T')[0];
      } catch {}
    }

    // Case / instrument number
    let caseNumber = null;
    const caseMatch = block.match(/(?:Case|Instrument|File|TS)\s*(?:Number|No\.?|#)\s*[:\s]+([A-Z0-9-]{4,30})/i);
    if (caseMatch) caseNumber = caseMatch[1].trim();

    // Trustee name
    let trustee = null;
    const trusteeMatch = block.match(/(?:Substitute Trustee|Trustee)[:\s]+([A-Z][A-Z\s,]+?)(?:\n|whose|appointed|c\/o)/);
    if (trusteeMatch) trustee = trusteeMatch[1].trim().substring(0, 100);

    // Mortgagee / lender
    let lender = null;
    const lenderMatch = block.match(/(?:Beneficiary|Mortgagee|Original Mortgagee|Lender)[:\s]+([A-Z][A-Z\s,&]+?)(?:\n|whose|c\/o)/);
    if (lenderMatch) lender = lenderMatch[1].trim().substring(0, 100);

    notices.push({ address, city, zip, saleDate, caseNumber, trustee, lender });
  }

  return notices;
}

function extractCityFromFilename(fn) {
  // Filenames like "Garland_3.pdf", "Farmers-Branch_4.pdf"
  if (!fn) return null;
  const m = fn.replace(/\.pdf$/i, '').replace(/_\d+$/, '').replace(/-/g, ' ').trim();
  return m || null;
}

module.exports = { scrapeDallasCountyForeclosures, nextFirstTuesdays };
