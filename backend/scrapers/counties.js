/**
 * Per-county configuration for all scrapers.
 *
 * Adding a new Texas county = add another entry here and the scrapers
 * automatically pick it up.
 */
module.exports = {
  Dallas: {
    name:           'Dallas',
    state:          'TX',
    // Map / display
    center:         { lat: 32.776, lng: -96.797 },
    zoom:           11,
    // Auction.com / Xome URL slugs
    auctionSlug:    'dallas-county',     // www.auction.com/residential/texas/dallas-county/
    xomeSlug:       'Dallas',            // www.xome.com/auctions/listing/TX/Dallas
    // HUD HomeStore search ("citystate" parameter on hudhomestore.gov)
    hudCityState:   'Dallas, TX',
    // Appraisal district owner lookup
    appraisal:      'DCAD',              // see ownerLookup.js
    // County Clerk foreclosure notice PDF index
    clerk: {
      // Dallas posts monthly PDF lists at this index URL
      indexUrl: 'https://www.dallascounty.org/government/county-clerk/recording/foreclosures.php',
      // PDF anchor pattern — anchors whose href contains this substring are PDFs we want
      pdfHrefIncludes: '/foreclosure/',
      pdfHostBase:     'https://www.dallascounty.org',
    },
    // Known city slugs (hyphen-separated, lowercase) for Auction.com slug parsing
    citySlugs2: [
      'grand-prairie','balch-springs','oak-leaf','farmers-branch',
      'cedar-hill','glenn-heights','cockrell-hill','de-soto',
      'oak-cliff','north-dallas','south-dallas','lake-highlands',
      'university-park','highland-park','oak-lawn','white-rock',
      'pleasant-grove','far-north-dallas',
    ],
    citySlugs1: [
      'dallas','irving','garland','mesquite','desoto','lancaster',
      'rowlett','hutchins','wilmer','seagoville','sunnyvale','sachse',
      'richardson','carrollton','duncanville',
    ],
    // Friendly city names for plain-text parsing
    cities: [
      'Dallas','Irving','Garland','Mesquite','DeSoto','Lancaster','Rowlett',
      'Grand Prairie','Duncanville','Balch Springs','Hutchins','Wilmer',
      'Seagoville','Sunnyvale','Sachse','Farmers Branch','Richardson',
      'Carrollton','Cedar Hill','Glenn Heights','Cockrell Hill','Oak Leaf',
    ],
  },

  Travis: {
    name:           'Travis',
    state:          'TX',
    center:         { lat: 30.2672, lng: -97.7431 },     // Austin
    zoom:           11,
    auctionSlug:    'travis-county',
    xomeSlug:       'Travis',
    hudCityState:   'Austin, TX',
    appraisal:      'TCAD',
    clerk: {
      // Travis County posts foreclosure notices via the County Clerk.
      // Their public listing page (Substitute Trustee's Sales):
      indexUrl: 'https://countyclerk.traviscountytx.gov/foreclosure-notices.html',
      pdfHrefIncludes: 'foreclosure',
      pdfHostBase:     'https://countyclerk.traviscountytx.gov',
    },
    citySlugs2: [
      'cedar-park','round-rock','bee-cave','west-lake-hills',
      'lago-vista','jonestown','sunset-valley','rollingwood',
      'point-venture','briarcliff','volente','san-leanna',
      'mustang-ridge','garfield','del-valle',
    ],
    citySlugs1: [
      'austin','pflugerville','manor','lakeway','elgin',
    ],
    cities: [
      'Austin','Pflugerville','Cedar Park','Round Rock','Lakeway','Bee Cave',
      'West Lake Hills','Manor','Sunset Valley','Jonestown','Lago Vista',
      'Rollingwood','Point Venture','Briarcliff','Volente','San Leanna',
      'Mustang Ridge','Garfield','Del Valle','Elgin',
    ],
  },
};
