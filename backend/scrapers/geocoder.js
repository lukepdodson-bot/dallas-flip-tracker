/**
 * Geocoder - converts street addresses to lat/lng coordinates
 * Uses Nominatim (OpenStreetMap) - free, no API key needed
 * Rate limit: 1 request/second (required by Nominatim ToS)
 */
const axios = require('axios');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function geocodeAddress(address, city = 'Dallas', state = 'TX') {
  try {
    const query = `${address}, ${city}, ${state}, USA`;
    const response = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: {
        q: query,
        format: 'json',
        limit: 1,
        countrycodes: 'us',
        addressdetails: 1,
      },
      headers: {
        'User-Agent': 'DallasForeClosureTracker/1.0 (contact@example.com)',
      },
      timeout: 10000,
    });

    if (response.data && response.data.length > 0) {
      const result = response.data[0];
      return {
        lat: parseFloat(result.lat),
        lng: parseFloat(result.lon),
      };
    }
  } catch (err) {
    console.error(`[Geocoder] Error for "${address}":`, err.message);
  }
  return null;
}

async function geocodeUngeocodedProperties(db) {
  const props = db.prepare(
    'SELECT id, address, city, state FROM properties WHERE lat IS NULL OR lng IS NULL LIMIT 50'
  ).all();

  if (props.length === 0) {
    console.log('[Geocoder] All properties are geocoded');
    return;
  }

  console.log(`[Geocoder] Geocoding ${props.length} properties...`);
  const update = db.prepare('UPDATE properties SET lat=?, lng=?, updated_at=datetime(\'now\') WHERE id=?');

  for (const prop of props) {
    const coords = await geocodeAddress(prop.address, prop.city, prop.state);
    if (coords) {
      update.run(coords.lat, coords.lng, prop.id);
      console.log(`[Geocoder] ${prop.address} -> ${coords.lat}, ${coords.lng}`);
    } else {
      console.log(`[Geocoder] Could not geocode: ${prop.address}`);
    }
    await sleep(1100); // Nominatim rate limit: 1 req/sec
  }

  console.log('[Geocoder] Done');
}

module.exports = { geocodeAddress, geocodeUngeocodedProperties };
