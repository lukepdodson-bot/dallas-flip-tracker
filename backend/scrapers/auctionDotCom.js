/**
 * Auction.com Scraper - Dallas County
 * Scrapes foreclosure and bank-owned properties listed for auction in Dallas County.
 */
const axios = require('axios');
const cheerio = require('cheerio');

async function scrapeAuctionDotCom() {
  const results = [];

  try {
    // Auction.com has a search API endpoint their site uses
    const response = await axios.get(
      'https://www.auction.com/api/listings/search',
      {
        params: {
          state: 'TX',
          county: 'Dallas',
          listingType: 'REF,BUY', // REF=foreclosure, BUY=bank-owned
          pageNum: 1,
          pageSize: 50,
          sort: 'openDate',
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Referer': 'https://www.auction.com/',
        },
        timeout: 15000,
      }
    );

    const data = response.data;
    const listings = data?.listings || data?.results || [];

    for (const listing of listings) {
      const county = (listing.county || '').toLowerCase();
      if (!county.includes('dallas')) continue;

      results.push({
        address: listing.address || listing.streetAddress,
        city: listing.city,
        zip_code: listing.zip || listing.postalCode,
        county: 'Dallas',
        lat: listing.latitude || listing.lat,
        lng: listing.longitude || listing.lng,
        price: listing.openingBid || listing.startingBid || listing.price,
        estimated_value: listing.assessedValue || listing.estimatedValue,
        bedrooms: listing.beds || listing.bedrooms,
        bathrooms: listing.baths || listing.bathrooms,
        sqft: listing.sqft || listing.squareFeet,
        year_built: listing.yearBuilt,
        property_type: normalizePropertyType(listing.propertyType),
        sale_type: listing.listingType === 'REF' ? 'Foreclosure' : 'REO',
        status: 'Active',
        auction_date: listing.auctionDate || listing.openDate,
        list_date: listing.listDate || listing.startDate,
        source: 'Auction.com',
        source_id: listing.id || listing.listingId,
        source_url: listing.url ? `https://www.auction.com${listing.url}` : null,
        description: listing.description || `Auction.com listing. Opening bid: $${listing.openingBid?.toLocaleString()}. Online auction.`,
      });
    }

    console.log(`[Auction.com] Found ${results.length} Dallas County listings`);
  } catch (err) {
    console.error('[Auction.com] Scrape error:', err.message);
  }

  return results;
}

function normalizePropertyType(type) {
  if (!type) return 'SFR';
  const t = type.toLowerCase();
  if (t.includes('condo') || t.includes('townhouse')) return 'Condo';
  if (t.includes('multi') || t.includes('duplex') || t.includes('triplex')) return 'Multi-Family';
  if (t.includes('land') || t.includes('lot')) return 'Land';
  if (t.includes('commercial')) return 'Commercial';
  return 'SFR';
}

module.exports = { scrapeAuctionDotCom };
