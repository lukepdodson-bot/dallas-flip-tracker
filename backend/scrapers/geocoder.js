/**
 * Geocoder — converts street addresses to lat/lng coordinates.
 *
 * Primary:   US Census Geocoder (free, no API key, US-only, accurate)
 *            https://geocoding.geo.census.gov/geocoder/
 * Fallback:  Nominatim (OpenStreetMap, sometimes blocks server IPs)
 */
const axios = require('axios');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function geocodeViaCensus(address, city, state) {
  try {
    const oneline = `${address}, ${city}, ${state}`;
    const res = await axios.get(
      'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress',
      {
        params: {
          address:   oneline,
          benchmark: 'Public_AR_Current',
          format:    'json',
        },
        timeout: 10000,
      }
    );
    const matches = res.data?.result?.addressMatches || [];
    if (matches.length > 0) {
      const m = matches[0];
      return { lat: parseFloat(m.coordinates.y), lng: parseFloat(m.coordinates.x), source: 'census' };
    }
  } catch (err) {
    console.error(`[Geocoder/Census] Error for "${address}":`, err.message);
  }
  return null;
}

async function geocodeViaNominatim(address, city, state) {
  try {
    const query = `${address}, ${city}, ${state}, USA`;
    const res = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: { q: query, format: 'json', limit: 1, countrycodes: 'us', addressdetails: 1 },
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DallasForeclosureTracker/1.0)',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 10000,
    });
    if (res.data && res.data.length > 0) {
      return { lat: parseFloat(res.data[0].lat), lng: parseFloat(res.data[0].lon), source: 'nominatim' };
    }
  } catch (err) {
    console.error(`[Geocoder/Nominatim] Error for "${address}":`, err.message);
  }
  return null;
}

async function geocodeAddress(address, city = 'Dallas', state = 'TX') {
  // Try US Census first (most reliable for US addresses)
  let result = await geocodeViaCensus(address, city, state);
  if (result) return result;

  // Fallback to Nominatim
  result = await geocodeViaNominatim(address, city, state);
  return result;
}

async function geocodeUngeocodedProperties(db) {
  const props = db.prepare(
    'SELECT id, address, city, state FROM properties WHERE lat IS NULL OR lng IS NULL LIMIT 200'
  ).all();

  if (props.length === 0) {
    console.log('[Geocoder] All properties already geocoded');
    return { total: 0, success: 0, failed: 0 };
  }

  console.log(`[Geocoder] Geocoding ${props.length} properties...`);
  const update = db.prepare("UPDATE properties SET lat=?, lng=?, updated_at=datetime('now') WHERE id=?");

  let success = 0, failed = 0;
  for (const prop of props) {
    const coords = await geocodeAddress(prop.address, prop.city, prop.state || 'TX');
    if (coords) {
      try {
        update.run(coords.lat, coords.lng, prop.id);
        success++;
        console.log(`[Geocoder] ✓ ${prop.address}, ${prop.city} → ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)} (${coords.source})`);
      } catch (e) {
        failed++;
        console.error(`[Geocoder] DB update failed for ${prop.address}: ${e.message}`);
      }
    } else {
      failed++;
      console.log(`[Geocoder] ✗ Could not geocode: ${prop.address}, ${prop.city}`);
    }
    // Census API doesn't have strict rate limit; small delay to be polite
    await sleep(300);
  }

  console.log(`[Geocoder] Done: ${success} succeeded, ${failed} failed`);
  return { total: props.length, success, failed };
}

module.exports = { geocodeAddress, geocodeUngeocodedProperties };
