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
const COUNTIES = require('./counties');

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

    const m = address.match(/^(\d+)\s+(.+)$/);
    if (!m) return null;
    const streetNum  = m[1];
    let rest = m[2];

    // Pull leading direction prefix (N/S/E/W/NE/NW/SE/SW)
    let direction = '';
    const dirMatch = rest.match(/^(N|S|E|W|NE|NW|SE|SW)\s+(.+)$/i);
    if (dirMatch) {
      direction = dirMatch[1].toUpperCase();
      rest = dirMatch[2];
    }

    // Strip trailing unit/suite/apartment qualifiers
    rest = rest.replace(/\s+(Unit|Apt|Ste|Suite|#)\s*[\w-]+\s*$/i, '');

    const streetName = rest
      .replace(/\s+(Dr|Drive|St|Street|Ave|Avenue|Ln|Lane|Rd|Road|Blvd|Boulevard|Ct|Court|Cir|Circle|Pl|Place|Way|Pkwy|Trl|Trail|Ter|Terrace|Sq|Square)\.?$/i, '')
      .trim();
    const cityUpper = (city || '').toUpperCase().trim();

    // Type into fields properly so ASP.NET sees the values
    await page.click('#txtAddrNum');
    await page.type('#txtAddrNum', streetNum, { delay: 30 });
    await page.click('#txtStName');
    await page.type('#txtStName', streetName, { delay: 30 });

    // Set direction dropdown if present
    if (direction) {
      await page.evaluate((dir) => {
        const sel = document.getElementById('listStDir');
        if (!sel) return;
        const opt = Array.from(sel.options).find(o => o.text.trim().toUpperCase() === dir);
        if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      }, direction);
    }

    // Select city in dropdown if known
    if (cityUpper) {
      try {
        const matched = await page.evaluate((cityVal) => {
          const sel = document.getElementById('listCity');
          if (!sel) return false;
          const opts = Array.from(sel.options);
          // Match option by visible text (DCAD pads with spaces)
          const opt = opts.find(o => o.text.trim().toUpperCase() === cityVal);
          if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); return true; }
          return false;
        }, cityUpper);
        if (!matched) console.log(`[DCAD] City "${cityUpper}" not in dropdown`);
      } catch {}
    }

    // Submit and wait
    await Promise.all([
      page.click('#cmdSubmit'),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
    ]);

    // Check current URL — we should now be on a results or detail page
    const url1 = page.url();
    console.log(`[DCAD] After submit: ${url1}`);

    // If we landed on a list of accounts, click the first one
    let onDetailPage = url1.includes('AcctDetail') || url1.includes('acctdetail');
    if (!onDetailPage) {
      const firstHref = await page.evaluate(() => {
        const link = document.querySelector('a[href*="AcctDetail" i], a[href*="acctdetail" i]');
        return link ? link.href : null;
      });
      if (firstHref) {
        console.log(`[DCAD] Following result link: ${firstHref}`);
        await page.goto(firstHref, { waitUntil: 'networkidle2', timeout: 30000 });
        onDetailPage = true;
      }
    }

    if (!onDetailPage) {
      console.log(`[DCAD] No result page reached for ${address}`);
      return null;
    }

    // Parse detail page — DCAD layout:
    //   Owner (Current YYYY)
    //   <Owner Name>            <- line 1
    //   <line 2 of owner name or mail line 1>
    //   <mail line 2>
    //   <mail line 3 — city/state/zip>
    //   <blank>
    //   Multi-Owner (Current YYYY)
    const detail = await page.evaluate(() => {
      const text = document.body.innerText || '';
      const lines = text.split('\n').map(l => l.trim());

      let startIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        if (/^Owner\s*\(Current\s+\d{4}\)$/i.test(lines[i])) { startIdx = i + 1; break; }
      }
      if (startIdx === -1) return { ownerName: null, mailingAddr: null };

      // Collect non-empty lines until a blank line OR until we hit a known section heading
      const stopRe = /^(Multi-Owner|Legal Desc|Value|Main Improvement|Additional Improvements|Land|Exemptions|Estimated Taxes|History|Property Location)/i;
      const block = [];
      for (let i = startIdx; i < lines.length && i < startIdx + 20; i++) {
        const l = lines[i];
        if (!l) {
          if (block.length > 0) break;   // blank line = end of block
          continue;                      // skip leading blanks
        }
        if (stopRe.test(l)) break;
        block.push(l);
      }
      if (block.length === 0) return { ownerName: null, mailingAddr: null };

      // First line is owner name. Detect if 2nd line is part of owner name
      // (e.g., "CWABS INC ASSETBACKED / CERTIFICATES SERIES 2006-22") vs. mailing.
      // Mailing address typically starts with a number or "PO BOX" / "P.O. BOX".
      const looksLikeStreetOrPO = (s) => /^(\d|PO\s+BOX|P\.?O\.?\s+BOX)/i.test(s);

      let ownerLines = [block[0]];
      let mailLines  = [];
      for (let i = 1; i < block.length; i++) {
        if (looksLikeStreetOrPO(block[i]) || mailLines.length > 0) {
          mailLines.push(block[i]);
        } else {
          ownerLines.push(block[i]);
        }
      }

      const ownerName  = ownerLines.join(' ').trim();
      const mailingAddr = mailLines.length ? mailLines.join(', ').trim() : null;
      return { ownerName, mailingAddr, url: window.location.href };
    });

    console.log(`[DCAD] Parsed: name="${detail.ownerName}" mail="${(detail.mailingAddr||'').substring(0, 60)}"`);

    if (detail.ownerName) {
      return {
        owner_name:            cleanName(detail.ownerName),
        owner_mailing_address: cleanAddr(detail.mailingAddr),
      };
    }
    return null;
  } catch (e) {
    console.error(`[DCAD] Error for "${address}":`, e.message.split('\n')[0]);
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Scrape TCAD (Travis Central Appraisal District) for owner info.
 *
 * TCAD search:
 *   https://search.traviscad.org/Search/
 *   → free-text search box accepts addresses; results page lists accounts
 *   → click account → detail page with Owner Name + Mailing Address
 *
 * @returns { owner_name, owner_mailing_address } or null
 */
async function scrapeTCAD(browser, address, city) {
  const page = await newPage(browser);
  try {
    console.log(`[TCAD] Looking up: ${address}, ${city}`);
    const searchUrl = `https://search.traviscad.org/Search/?searchtext=${encodeURIComponent(address)}&searchtype=1`;
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.humanDelay();

    // TCAD shows a results table — click first matching account link
    const firstHref = await page.evaluate(() => {
      const link = document.querySelector('a[href*="/Property/View/"], a[href*="/Property/Detail"], a[href*="View?"]');
      return link ? link.href : null;
    });

    if (!firstHref) {
      console.log(`[TCAD] No result for ${address}`);
      return null;
    }

    console.log(`[TCAD] Following: ${firstHref}`);
    await page.goto(firstHref, { waitUntil: 'networkidle2', timeout: 30000 });

    // Detail page — owner info usually in a labeled section
    const detail = await page.evaluate(() => {
      const text = document.body.innerText || '';
      const lines = text.split('\n').map(l => l.trim());

      // Look for "Owner Information" or "Owner Name" header
      let startIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        if (/^(Owner|Owner Information|Owner Name|Property Owner)/i.test(lines[i])) {
          startIdx = i + 1;
          break;
        }
      }
      if (startIdx === -1) return { ownerName: null, mailingAddr: null };

      const stopRe = /^(Property|Legal|Value|Improvement|Land|Exemption|Tax|History|Map|Photo)/i;
      const block = [];
      for (let i = startIdx; i < lines.length && i < startIdx + 12; i++) {
        const l = lines[i];
        if (!l) { if (block.length > 0) break; continue; }
        if (stopRe.test(l)) break;
        // Skip lines that are just labels like "Mailing Address:"
        if (/^[A-Z][a-z]+( [A-Z][a-z]+)*:\s*$/.test(l)) continue;
        block.push(l);
      }
      if (block.length === 0) return { ownerName: null, mailingAddr: null };

      const looksLikeStreetOrPO = (s) => /^(\d|PO\s+BOX|P\.?O\.?\s+BOX)/i.test(s);
      let ownerLines = [block[0]];
      let mailLines  = [];
      for (let i = 1; i < block.length; i++) {
        if (looksLikeStreetOrPO(block[i]) || mailLines.length > 0) {
          mailLines.push(block[i]);
        } else {
          ownerLines.push(block[i]);
        }
      }

      return {
        ownerName:   ownerLines.join(' ').trim(),
        mailingAddr: mailLines.length ? mailLines.join(', ').trim() : null,
      };
    });

    console.log(`[TCAD] Parsed: name="${detail.ownerName}" mail="${(detail.mailingAddr||'').substring(0, 60)}"`);

    if (detail.ownerName) {
      return {
        owner_name:            cleanName(detail.ownerName),
        owner_mailing_address: cleanAddr(detail.mailingAddr),
      };
    }
    return null;
  } catch (e) {
    console.error(`[TCAD] Error for "${address}":`, e.message.split('\n')[0]);
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Pick the appraisal-district scraper based on the property's county.
 */
async function scrapeAppraisal(browser, address, city, county) {
  const cfg = COUNTIES[county];
  const district = cfg?.appraisal;
  if (district === 'TCAD') return scrapeTCAD(browser, address, city);
  // Default to DCAD for Dallas (and as a safe fallback)
  return scrapeDCAD(browser, address, city);
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
    SELECT id, address, city, county
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
      const county = p.county || 'Dallas';
      const owner = await scrapeAppraisal(browser, p.address, p.city || COUNTIES[county]?.cities[0] || 'Dallas', county);
      let phone = null;

      if (owner?.owner_name && includePhone) {
        phone = await skipTracePhone(browser, owner.owner_name, p.city || COUNTIES[county]?.cities[0] || 'Dallas');
      }

      try {
        update.run(
          owner?.owner_name           || null,
          owner?.owner_mailing_address || null,
          phone                      || null,
          p.id
        );
        if (owner?.owner_name) {
          success++;
          console.log(`[Owner] ✓ ${p.address} (${county}): ${owner.owner_name}${phone ? ' / '+phone : ''}`);
        } else {
          failed++;
          console.log(`[Owner] ✗ ${p.address} (${county}): no appraisal-district match`);
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

module.exports = { enrichOwners, scrapeDCAD, scrapeTCAD, scrapeAppraisal, skipTracePhone };
