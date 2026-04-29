/**
 * HUD Homes Scraper
 * Scrapes hudhomestore.gov for Dallas County REO properties.
 * HUD offers homes owned by the government after FHA-insured mortgage defaults.
 */
const axios = require('axios');
const cheerio = require('cheerio');

const DALLAS_ZIPS = [
  '75201','75202','75203','75204','75205','75206','75207','75208','75209','75210',
  '75211','75212','75214','75215','75216','75217','75218','75219','75220','75223',
  '75224','75225','75226','75227','75228','75229','75230','75231','75232','75233',
  '75234','75235','75236','75237','75238','75240','75241','75243','75244','75246',
  '75249','75287','75051','75052','75060','75061','75062','75063','75115','75116',
  '75134','75146','75149','75150','75040','75041','75042','75043','75044','75088',
  '75089','75180','75181','75182','75087'
];

async function scrapeHUDHomes() {
  const results = [];

  try {
    // HUD Home Store search API
    const searchUrl = 'https://www.hudhomestore.gov/Listing/PropertySearchResult.aspx';

    const params = new URLSearchParams({
      zipCode: '',
      city: 'Dallas',
      state: 'TX',
      county: 'DALLAS',
      propertyType: '',
      listing: '',
      bedroom: '',
      bathroom: '',
      garage: '',
      fireplaceFlg: '',
      basementFlg: '',
      acFlg: '',
      searchType: 'searchByCity',
      pageNumber: '1',
      pageSize: '50',
      sortField: 'listdate',
      sortOrder: 'DESC',
    });

    const response = await axios.get(`${searchUrl}?${params}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      timeout: 15000,
    });

    const $ = cheerio.load(response.data);

    // Parse HUD listing table
    $('table.table tr').each((i, row) => {
      if (i === 0) return; // skip header
      const cells = $(row).find('td');
      if (cells.length < 5) return;

      const address = $(cells[0]).text().trim();
      const city = $(cells[1]).text().trim();
      const zip = $(cells[2]).text().trim();
      const price = parseFloat($(cells[3]).text().replace(/[^0-9.]/g, '')) || null;
      const beds = parseInt($(cells[4]).text()) || null;
      const baths = parseFloat($(cells[5]).text()) || null;
      const listDate = $(cells[6]).text().trim();
      const caseNum = $(cells[7]).text().trim();
      const url = $(cells[0]).find('a').attr('href');

      if (address && DALLAS_ZIPS.includes(zip)) {
        results.push({
          address,
          city: city || 'Dallas',
          zip_code: zip,
          county: 'Dallas',
          price,
          bedrooms: beds,
          bathrooms: baths,
          list_date: listDate ? new Date(listDate).toISOString().split('T')[0] : null,
          property_type: 'SFR',
          sale_type: 'REO',
          status: 'Active',
          source: 'HUD Homes',
          source_id: caseNum || `HUD-${address.replace(/\s+/g, '-')}`,
          source_url: url ? `https://www.hudhomestore.gov${url}` : null,
          case_number: caseNum,
          description: 'HUD Home - sold as-is. Contact listing broker for showing instructions.',
        });
      }
    });

    console.log(`[HUD Homes] Found ${results.length} Dallas County properties`);
  } catch (err) {
    console.error('[HUD Homes] Scrape error:', err.message);
    // Return empty - app continues with existing data
  }

  return results;
}

module.exports = { scrapeHUDHomes };
