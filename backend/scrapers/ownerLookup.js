/**
 * Owner Lookup
 *
 * For each property, look up:
 *   - Owner name + mailing address from DCAD (Dallas Central Appraisal District)
 *     — public record, free, reliable
 *   - Phone number from TruePeopleSearch (best-effort, often blocked by CAPTCHA)
 *     — public record but anti-scraping; results may be empty
 *   - Email — almost never publicly available without paid skip-trace API
 */
const { launchBrowser, newPage } = require('./browser');

/**
 * Scrape DCAD for owner name and mailing address.
 *
 * DCAD search:
 *   https://www.dallascad.org/SearchAddr.aspx → POST search → results table
 *
 * @returns { owner_name, owner_mailing_address } or null
 */
async function scrapeDCAD(browser, address, city) {
  const page = await newPage(browser);
  try {
    console.log(`[DCAD] Looking up: ${address}, ${city}`);
    await page.goto('https://www.dallascad.org/SearchAddr.aspx', {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    // Fill in street number + street name from address
    // DCAD takes street-number and street-name separately
    const m = address.match(/^(\d+)\s+(.+)$/);
    if (!m) return null;
    const streetNum  = m[1];
    const streetName = m[2]
      .replace(/\s+(Dr|Drive|St|Street|Ave|Avenue|Ln|Lane|Rd|Road|Blvd|Boulevard|Ct|Court|Cir|Circle|Pl|Place|Way|Pkwy|Trl|Trail)\.?$/i, '')
      .trim();

    await page.evaluate((num, name) => {
      const numEl  = document.querySelector('input[id*="StreetNum"], input[name*="StreetNum"]');
      const nameEl = document.querySelector('input[id*="StreetName"], input[name*="StreetName"]');
      if (numEl)  numEl.value  = num;
      if (nameEl) nameEl.value = name;
    }, streetNum, streetName);

    // Submit the form
    const submitted = await page.evaluate(() => {
      const btn = document.querySelector('input[type="submit"], button[type="submit"]');
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (!submitted) return null;

    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});

    // Parse results: DCAD returns either an account-detail page or a list of matches
    const result = await page.evaluate(() => {
      // Account detail page has owner info in a <table> or <tr> structure
      const text = document.body.innerText || '';

      // Match "Owner Name" followed by name (DCAD layout: label / value pairs in rows)
      const ownerMatch = text.match(/Owner Name\s*[:\n]+\s*([^\n]{2,80})/i)
                     || text.match(/Owner\s*[:\n]+\s*([^\n]{2,80})/i);

      // Mailing address pattern: "Mailing Address" then 1-3 lines of address
      const mailMatch = text.match(/Mailing Address\s*[:\n]+\s*([^\n]+(?:\n[^\n]+){0,2})/i);

      // If we got a list of results, take the first link and follow
      const firstLink = document.querySelector('a[href*="AcctDetail"], a[href*="acctdetail"]');

      return {
        ownerName:    ownerMatch ? ownerMatch[1].trim() : null,
        mailingAddr:  mailMatch  ? mailMatch[1].trim().replace(/\n/g, ', ') : null,
        firstLinkHref: firstLink ? firstLink.getAttribute('href') : null,
        title:         document.title,
        url:           window.location.href,
      };
    });

    // If we got results-list, follow first link
    if (!result.ownerName && result.firstLinkHref) {
      const detailUrl = new URL(result.firstLinkHref, page.url()).toString();
      console.log(`[DCAD] Following result: ${detailUrl}`);
      await page.goto(detailUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      const detail = await page.evaluate(() => {
        const text = document.body.innerText || '';
        const ownerMatch = text.match(/Owner Name\s*[:\n]+\s*([^\n]{2,80})/i)
                       || text.match(/Owner\s*[:\n]+\s*([^\n]{2,80})/i);
        const mailMatch  = text.match(/Mailing Address\s*[:\n]+\s*([^\n]+(?:\n[^\n]+){0,2})/i);
        return {
          ownerName:   ownerMatch ? ownerMatch[1].trim() : null,
          mailingAddr: mailMatch  ? mailMatch[1].trim().replace(/\n/g, ', ') : null,
        };
      });
      if (detail.ownerName) {
        return {
          owner_name:            cleanName(detail.ownerName),
          owner_mailing_address: cleanAddr(detail.mailingAddr),
        };
      }
    }

    if (result.ownerName) {
      return {
        owner_name:            cleanName(result.ownerName),
        owner_mailing_address: cleanAddr(result.mailingAddr),
      };
    }
    console.log(`[DCAD] No match for ${address}`);
    return null;
  } catch (e) {
    console.error(`[DCAD] Error for "${address}":`, e.message.split('\n')[0]);
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Best-effort: try TruePeopleSearch for phone number.
 * Often blocked by CAPTCHA — returns null if so.
 */
async function skipTracePhone(browser, ownerName, city) {
  if (!ownerName) return null;
  const page = await newPage(browser);
  try {
    // Strip suffixes/prefixes ("ETUX", "ETAL", "TRUSTEE", "&" from joint owners)
    const cleanedName = ownerName
      .replace(/\b(ETUX|ETAL|TRUSTEE|TRUST|LLC|INC|CORP|LP|ESTATE|JR|SR|II|III)\b/gi, '')
      .replace(/&.*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleanedName.split(' ').length < 2) return null;

    const url = `https://www.truepeoplesearch.com/results?name=${encodeURIComponent(cleanedName)}&citystatezip=${encodeURIComponent(city + ', TX')}`;
    console.log(`[SkipTrace] ${cleanedName} in ${city}`);

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
    await page.humanDelay();

    const data = await page.evaluate(() => {
      const text = document.body.innerText || '';
      // Look for "Page Not Found", CAPTCHA, or block messages
      if (/Access Denied|captcha|blocked|verify you/i.test(text)) return { blocked: true };

      // Phone pattern (common formats)
      const phoneMatch = text.match(/\(\d{3}\)\s*\d{3}-\d{4}/);
      // Or a tel: link
      const telLink = document.querySelector('a[href^="tel:"]');
      const telPhone = telLink ? telLink.getAttribute('href').replace('tel:', '') : null;

      return {
        phone:   phoneMatch ? phoneMatch[0] : telPhone,
        blocked: false,
      };
    });

    if (data.blocked) {
      console.log(`[SkipTrace] Blocked / CAPTCHA for ${cleanedName}`);
      return null;
    }
    return data.phone || null;
  } catch (e) {
    console.error(`[SkipTrace] Error: ${e.message.split('\n')[0]}`);
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

function cleanName(n) {
  if (!n) return null;
  return n.replace(/\s+/g, ' ').replace(/^[\s,;:-]+|[\s,;:-]+$/g, '').substring(0, 200);
}
function cleanAddr(a) {
  if (!a) return null;
  return a.replace(/\s+/g, ' ').replace(/^[\s,;:-]+|[\s,;:-]+$/g, '').substring(0, 300);
}

/**
 * Loop through properties without owner data and enrich them.
 */
async function enrichOwners(db, options = {}) {
  const { limit = 100, includePhone = true } = options;

  const props = db.prepare(`
    SELECT id, address, city
      FROM properties
     WHERE (owner_name IS NULL OR owner_name = '')
       AND owner_lookup_attempted IS NULL
     LIMIT ?
  `).all(limit);

  if (props.length === 0) {
    console.log('[Owner] All properties already enriched');
    return { total: 0, success: 0, failed: 0 };
  }

  console.log(`[Owner] Enriching ${props.length} properties...`);
  let browser;
  let success = 0, failed = 0;

  try {
    browser = await launchBrowser();
    const update = db.prepare(`
      UPDATE properties
         SET owner_name = ?, owner_mailing_address = ?, owner_phone = ?,
             owner_lookup_attempted = datetime('now'), updated_at = datetime('now')
       WHERE id = ?
    `);

    for (const p of props) {
      const dcad = await scrapeDCAD(browser, p.address, p.city || 'Dallas');
      let phone = null;

      if (dcad?.owner_name && includePhone) {
        phone = await skipTracePhone(browser, dcad.owner_name, p.city || 'Dallas');
      }

      try {
        update.run(
          dcad?.owner_name           || null,
          dcad?.owner_mailing_address || null,
          phone                      || null,
          p.id
        );
        if (dcad?.owner_name) {
          success++;
          console.log(`[Owner] ✓ ${p.address}: ${dcad.owner_name}${phone ? ' / '+phone : ''}`);
        } else {
          failed++;
          console.log(`[Owner] ✗ ${p.address}: no DCAD match`);
        }
      } catch (e) {
        failed++;
        console.error(`[Owner] DB update failed for ${p.address}: ${e.message}`);
      }
    }
  } catch (err) {
    console.error('[Owner] Fatal error:', err.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  console.log(`[Owner] Done: ${success} succeeded, ${failed} failed`);
  return { total: props.length, success, failed };
}

module.exports = { enrichOwners, scrapeDCAD, skipTracePhone };
