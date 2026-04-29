require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db/database');

console.log('Seeding database...');

// --- Users ---
// Rename legacy 'buddy' account to 'john' if it exists
try {
  const buddyExists = db.prepare(`SELECT id FROM users WHERE username = 'buddy'`).get();
  if (buddyExists) {
    db.prepare(`UPDATE users SET username = 'john', email = 'john@example.com' WHERE username = 'buddy'`).run();
    console.log('Renamed user "buddy" → "john"');
  }
} catch (e) { /* ignore */ }

const users = [
  { username: 'luke', email: 'luke@example.com', password: 'FlipDallas2024!', role: 'admin' },
  { username: 'john', email: 'john@example.com', password: 'FlipDallas2024!', role: 'user' },
];

for (const u of users) {
  const hash = bcrypt.hashSync(u.password, 10);
  try {
    db.prepare(`
      INSERT INTO users (username, email, password_hash, role)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET email=excluded.email, role=excluded.role
    `).run(u.username, u.email, hash, u.role);
    console.log(`User "${u.username}" created/updated (password: ${u.password})`);
  } catch (e) {
    console.log(`User "${u.username}" already exists`);
  }
}

// --- Seed Properties ---
// Realistic Dallas County distressed properties
// First Tuesdays (foreclosure auction days in TX): May 6 2025, Jun 3, Jul 1, Aug 5, Sep 2
const today = '2026-04-24';
const properties = [
  {
    address: '4521 Elam Rd', city: 'Dallas', zip_code: '75227', county: 'Dallas',
    lat: 32.7431, lng: -96.6892, price: 78000, estimated_value: 145000,
    bedrooms: 3, bathrooms: 1, sqft: 1100, lot_size_sqft: 6500, year_built: 1958,
    property_type: 'SFR', sale_type: 'Foreclosure', status: 'Active',
    auction_date: '2026-05-05', list_date: '2026-04-01',
    source: 'Dallas County Clerk', source_id: 'DC-2026-04521',
    description: '3/1 brick home in Pleasant Grove. Deferred maintenance throughout, needs full rehab. Foundation has some movement per disclosure. Strong rental area - comps at $1,100/mo.',
    lender: 'Wells Fargo Bank', case_number: '2026-FC-04521',
  },
  {
    address: '2318 Bonnie View Rd', city: 'Dallas', zip_code: '75216', county: 'Dallas',
    lat: 32.7042, lng: -96.8012, price: 55000, estimated_value: 105000,
    bedrooms: 3, bathrooms: 1, sqft: 980, lot_size_sqft: 7200, year_built: 1952,
    property_type: 'SFR', sale_type: 'Foreclosure', status: 'Active',
    auction_date: '2026-05-05', list_date: '2026-03-28',
    source: 'Dallas County Clerk', source_id: 'DC-2026-02318',
    description: 'Wood frame home, fire damage to kitchen and living area. Cash/hard money only. Investor opportunity in growing South Dallas corridor.',
    lender: 'Nationstar Mortgage', case_number: '2026-FC-02318',
  },
  {
    address: '1047 Chalk Hill Rd', city: 'Dallas', zip_code: '75212', county: 'Dallas',
    lat: 32.7724, lng: -96.8891, price: 92000, estimated_value: 165000,
    bedrooms: 3, bathrooms: 2, sqft: 1250, lot_size_sqft: 5800, year_built: 1962,
    property_type: 'SFR', sale_type: 'REO', status: 'Active',
    auction_date: null, list_date: '2026-04-10',
    source: 'HUD Homes', source_id: 'HUD-2026-TX-01047',
    description: 'Bank-owned property in West Dallas. Previous owner made partial updates to bathrooms. Roof is 8 years old. Close to Trinity Groves development.',
    lender: 'Bank of America',
  },
  {
    address: '5832 Masters Dr', city: 'Dallas', zip_code: '75241', county: 'Dallas',
    lat: 32.6734, lng: -96.8234, price: 48000, estimated_value: 98000,
    bedrooms: 2, bathrooms: 1, sqft: 876, lot_size_sqft: 8100, year_built: 1949,
    property_type: 'SFR', sale_type: 'Tax Sale', status: 'Active',
    auction_date: '2026-05-05', list_date: '2026-04-05',
    source: 'Dallas County Tax Office', source_id: 'TAX-2026-05832',
    description: 'Tax delinquent property, 4 years past due. Older pier and beam construction. Large lot, potential to scrape and rebuild or renovate. Buyer responsible for back taxes (~$12,400).',
    case_number: 'TAX-2026-05832',
  },
  {
    address: '3401 Forney Rd', city: 'Dallas', zip_code: '75227', county: 'Dallas',
    lat: 32.7512, lng: -96.6701, price: 105000, estimated_value: 178000,
    bedrooms: 4, bathrooms: 2, sqft: 1680, lot_size_sqft: 7800, year_built: 1971,
    property_type: 'SFR', sale_type: 'Short Sale', status: 'Active',
    auction_date: null, list_date: '2026-04-15',
    source: 'MLS/Short Sale', source_id: 'SS-2026-03401',
    description: 'Approved short sale, lender-approved at list price. 4 bed 2 bath in Pleasant Grove. Updated HVAC (2022), original kitchen. Owner occupied, shows well.',
    lender: 'Chase Home Lending',
  },
  {
    address: '718 Bickers St', city: 'Dallas', zip_code: '75212', county: 'Dallas',
    lat: 32.7831, lng: -96.8791, price: 67000, estimated_value: 130000,
    bedrooms: 3, bathrooms: 1, sqft: 1050, lot_size_sqft: 6200, year_built: 1956,
    property_type: 'SFR', sale_type: 'Foreclosure', status: 'Active',
    auction_date: '2026-06-02', list_date: '2026-04-20',
    source: 'Dallas County Clerk', source_id: 'DC-2026-00718',
    description: 'Brick home with hardwood floors throughout. Needs roof, HVAC, and cosmetic updates. West Dallas, 10 min to downtown. High investor activity in this zip.',
    lender: 'Mr. Cooper', case_number: '2026-FC-00718',
  },
  {
    address: '4109 Singing Hills Rd', city: 'Dallas', zip_code: '75216', county: 'Dallas',
    lat: 32.6891, lng: -96.8345, price: 62000, estimated_value: 115000,
    bedrooms: 3, bathrooms: 1, sqft: 1020, lot_size_sqft: 7000, year_built: 1955,
    property_type: 'SFR', sale_type: 'Foreclosure', status: 'Active',
    auction_date: '2026-05-05', list_date: '2026-03-15',
    source: 'Dallas County Clerk', source_id: 'DC-2026-04109',
    description: 'Occupied foreclosure, do not disturb occupants. Drive-by only until sold. Pier and beam, needs foundation leveling. Sold as-is.',
    lender: 'Freedom Mortgage', case_number: '2026-FC-04109',
  },
  {
    address: '8823 Bruton Rd', city: 'Dallas', zip_code: '75217', county: 'Dallas',
    lat: 32.7162, lng: -96.6423, price: 89000, estimated_value: 155000,
    bedrooms: 3, bathrooms: 2, sqft: 1320, lot_size_sqft: 6800, year_built: 1978,
    property_type: 'SFR', sale_type: 'REO', status: 'Active',
    auction_date: null, list_date: '2026-04-08',
    source: 'HUD Homes', source_id: 'HUD-2026-TX-08823',
    description: 'HUD Home, sold as-is. FHA financing possible with escrow repair addendum. 3/2 in Pleasant Grove area, good bones, needs cosmetics. New windows in 2021.',
  },
  {
    address: '2710 Lake June Rd', city: 'Dallas', zip_code: '75232', county: 'Dallas',
    lat: 32.6923, lng: -96.8601, price: 72000, estimated_value: 132000,
    bedrooms: 3, bathrooms: 1, sqft: 1100, lot_size_sqft: 8500, year_built: 1961,
    property_type: 'SFR', sale_type: 'Foreclosure', status: 'Active',
    auction_date: '2026-05-05', list_date: '2026-04-02',
    source: 'Dallas County Clerk', source_id: 'DC-2026-02710',
    description: 'Brick home on large lot in Redbird area. Property has been vacant 18+ months. Needs full renovation including electrical update. Possible ADU potential on lot.',
    lender: 'Carrington Mortgage', case_number: '2026-FC-02710',
  },
  {
    address: '635 Ledbetter Dr', city: 'Dallas', zip_code: '75216', county: 'Dallas',
    lat: 32.7089, lng: -96.8234, price: 43000, estimated_value: 88000,
    bedrooms: 2, bathrooms: 1, sqft: 820, lot_size_sqft: 5600, year_built: 1948,
    property_type: 'SFR', sale_type: 'Tax Sale', status: 'Active',
    auction_date: '2026-05-05', list_date: '2026-04-05',
    source: 'Dallas County Tax Office', source_id: 'TAX-2026-00635',
    description: 'Tax lien sale. Property has code violations on file. Small 2/1 with detached garage. Rehab or scrape for new construction. Back taxes approx $9,800.',
    case_number: 'TAX-2026-00635',
  },
  {
    address: '1502 Westmoreland Rd', city: 'Dallas', zip_code: '75211', county: 'Dallas',
    lat: 32.7321, lng: -96.9012, price: 118000, estimated_value: 198000,
    bedrooms: 4, bathrooms: 2, sqft: 1780, lot_size_sqft: 8200, year_built: 1968,
    property_type: 'SFR', sale_type: 'Foreclosure', status: 'Active',
    auction_date: '2026-06-02', list_date: '2026-04-18',
    source: 'Dallas County Clerk', source_id: 'DC-2026-01502',
    description: '4/2 in North Oak Cliff near Kessler Park. Motivated seller situation. Updated roof, original everything else. Strong appreciation neighborhood, ARV comps above $250k.',
    lender: 'Lakeview Loan Servicing', case_number: '2026-FC-01502',
  },
  {
    address: '4422 Hampton Rd', city: 'Dallas', zip_code: '75236', county: 'Dallas',
    lat: 32.7034, lng: -96.9234, price: 58000, estimated_value: 108000,
    bedrooms: 3, bathrooms: 1, sqft: 990, lot_size_sqft: 6900, year_built: 1954,
    property_type: 'SFR', sale_type: 'Foreclosure', status: 'Active',
    auction_date: '2026-05-05', list_date: '2026-03-30',
    source: 'Dallas County Clerk', source_id: 'DC-2026-04422',
    description: 'Concrete block construction. Needs roof replacement and full interior rehab. Quiet street in Cockrell Hill border area. Cash only.',
    lender: 'Pennymac', case_number: '2026-FC-04422',
  },
  {
    address: '7710 Samuell Blvd', city: 'Dallas', zip_code: '75228', county: 'Dallas',
    lat: 32.7601, lng: -96.6912, price: 135000, estimated_value: 215000,
    bedrooms: 4, bathrooms: 2, sqft: 1920, lot_size_sqft: 9100, year_built: 1976,
    property_type: 'SFR', sale_type: 'Short Sale', status: 'Active',
    auction_date: null, list_date: '2026-04-12',
    source: 'MLS/Short Sale', source_id: 'SS-2026-07710',
    description: 'Short sale contingent on lender approval, typically 60-90 days. East Dallas 4/2 with original oak floors. Updated HVAC and water heater. Good school district.',
    lender: 'US Bank',
  },
  {
    address: '923 Singleton Blvd', city: 'Dallas', zip_code: '75212', county: 'Dallas',
    lat: 32.7842, lng: -96.8689, price: 49000, estimated_value: 95000,
    bedrooms: 2, bathrooms: 1, sqft: 850, lot_size_sqft: 5200, year_built: 1945,
    property_type: 'SFR', sale_type: 'Tax Sale', status: 'Active',
    auction_date: '2026-05-05', list_date: '2026-04-05',
    source: 'Dallas County Tax Office', source_id: 'TAX-2026-00923',
    description: 'Older wood frame in West Dallas near Sylvan/Singleton corridor. High development pressure in area - several new construction nearby. Back taxes approx $11,200.',
    case_number: 'TAX-2026-00923',
  },
  {
    address: '5206 Military Pkwy', city: 'Dallas', zip_code: '75227', county: 'Dallas',
    lat: 32.7478, lng: -96.7012, price: 96000, estimated_value: 160000,
    bedrooms: 3, bathrooms: 2, sqft: 1400, lot_size_sqft: 7600, year_built: 1973,
    property_type: 'SFR', sale_type: 'REO', status: 'Active',
    auction_date: null, list_date: '2026-04-05',
    source: 'Fannie Mae HomePath', source_id: 'FN-2026-05206',
    description: 'Fannie Mae HomePath property. First look period has passed, all buyers welcome. 3/2 with 2-car garage. Updates needed: kitchen, baths, flooring.',
  },
  {
    address: '3018 Polk St', city: 'Dallas', zip_code: '75215', county: 'Dallas',
    lat: 32.7612, lng: -96.7823, price: 41000, estimated_value: 82000,
    bedrooms: 2, bathrooms: 1, sqft: 780, lot_size_sqft: 4800, year_built: 1942,
    property_type: 'SFR', sale_type: 'Foreclosure', status: 'Active',
    auction_date: '2026-05-05', list_date: '2026-04-03',
    source: 'Dallas County Clerk', source_id: 'DC-2026-03018',
    description: 'South Dallas 2/1, minimal remaining value in structure. Best suited for scrape and new build. Zip code seeing significant new construction investment.',
    lender: 'Selene Finance', case_number: '2026-FC-03018',
  },
  {
    address: '1842 Ferguson Rd', city: 'Dallas', zip_code: '75228', county: 'Dallas',
    lat: 32.7534, lng: -96.6798, price: 122000, estimated_value: 192000,
    bedrooms: 3, bathrooms: 2, sqft: 1550, lot_size_sqft: 8400, year_built: 1981,
    property_type: 'SFR', sale_type: 'Foreclosure', status: 'Pending',
    auction_date: '2026-04-01', list_date: '2026-03-01',
    source: 'Dallas County Clerk', source_id: 'DC-2026-01842',
    description: 'Auction complete, awaiting title. 3/2 in East Dallas. Updated roof (2020), HVAC (2019). Kitchen and baths original. Good flip potential.',
    lender: 'Truist Mortgage', case_number: '2026-FC-01842',
  },
  {
    address: '6334 Cockrell Hill Rd', city: 'Dallas', zip_code: '75236', county: 'Dallas',
    lat: 32.7156, lng: -96.9123, price: 53000, estimated_value: 99000,
    bedrooms: 3, bathrooms: 1, sqft: 920, lot_size_sqft: 7100, year_built: 1951,
    property_type: 'SFR', sale_type: 'Foreclosure', status: 'Active',
    auction_date: '2026-06-02', list_date: '2026-04-22',
    source: 'Dallas County Clerk', source_id: 'DC-2026-06334',
    description: 'Pier and beam home needs leveling. Foundation quote ~$8k. After foundation and full cosmetic rehab, strong rent demand in this pocket of SW Dallas.',
    lender: 'BSI Financial', case_number: '2026-FC-06334',
  },
  {
    address: '2205 Wheatland Rd', city: 'Dallas', zip_code: '75232', county: 'Dallas',
    lat: 32.6734, lng: -96.8712, price: 76000, estimated_value: 138000,
    bedrooms: 3, bathrooms: 2, sqft: 1200, lot_size_sqft: 7800, year_built: 1965,
    property_type: 'SFR', sale_type: 'REO', status: 'Active',
    auction_date: null, list_date: '2026-04-14',
    source: 'HUD Homes', source_id: 'HUD-2026-TX-02205',
    description: 'HUD Home, IE (Insured with Escrow). FHA financing eligible. 3/2 near Camp Wisdom. Roof replaced by HUD prior to listing. Needs $25-30k in updates.',
  },
  {
    address: '9012 Scyene Rd', city: 'Dallas', zip_code: '75227', county: 'Dallas',
    lat: 32.7368, lng: -96.6534, price: 84000, estimated_value: 148000,
    bedrooms: 3, bathrooms: 1.5, sqft: 1180, lot_size_sqft: 6600, year_built: 1969,
    property_type: 'SFR', sale_type: 'Foreclosure', status: 'Active',
    auction_date: '2026-07-07', list_date: '2026-04-23',
    source: 'Dallas County Clerk', source_id: 'DC-2026-09012',
    description: 'Just listed. Notice of Trustee Sale posted. 3/1.5, brick veneer. Occupied - do not contact owner. Large corner lot.',
    lender: 'NewRez/Shellpoint', case_number: '2026-FC-09012',
  },
  // Grand Prairie
  {
    address: '3421 W Pioneer Dr', city: 'Grand Prairie', zip_code: '75051', county: 'Dallas',
    lat: 32.7456, lng: -97.0145, price: 88000, estimated_value: 162000,
    bedrooms: 3, bathrooms: 2, sqft: 1350, lot_size_sqft: 8000, year_built: 1974,
    property_type: 'SFR', sale_type: 'Foreclosure', status: 'Active',
    auction_date: '2026-05-05', list_date: '2026-04-01',
    source: 'Dallas County Clerk', source_id: 'DC-2026-GP-03421',
    description: 'Grand Prairie 3/2, good street presence. Needs kitchen and bath updates. 2-car garage. Strong rental market, comps at $1,400/mo.',
    lender: 'Caliber Home Loans', case_number: '2026-FC-GP-03421',
  },
  // Mesquite
  {
    address: '1608 Faithon P Lucas Sr Blvd', city: 'Mesquite', zip_code: '75149', county: 'Dallas',
    lat: 32.7678, lng: -96.5989, price: 102000, estimated_value: 172000,
    bedrooms: 4, bathrooms: 2, sqft: 1720, lot_size_sqft: 9200, year_built: 1982,
    property_type: 'SFR', sale_type: 'REO', status: 'Active',
    auction_date: null, list_date: '2026-04-07',
    source: 'Fannie Mae HomePath', source_id: 'FN-2026-01608',
    description: 'Fannie Mae REO in Mesquite. 4/2 with large backyard. Updated roof. Needs HVAC, kitchen and master bath. Good school district, family-friendly neighborhood.',
  },
  // Irving
  {
    address: '2901 N Story Rd', city: 'Irving', zip_code: '75062', county: 'Dallas',
    lat: 32.8312, lng: -96.9789, price: 115000, estimated_value: 195000,
    bedrooms: 3, bathrooms: 2, sqft: 1480, lot_size_sqft: 7400, year_built: 1978,
    property_type: 'SFR', sale_type: 'Short Sale', status: 'Active',
    auction_date: null, list_date: '2026-04-16',
    source: 'MLS/Short Sale', source_id: 'SS-2026-02901',
    description: 'Lender-approved short sale. Irving 3/2 near Valley Ranch. Updated windows and HVAC. Original kitchen and baths. Excellent location near DFW Airport corridor.',
    lender: 'JP Morgan Chase',
  },
  // Garland
  {
    address: '5512 Naaman Forest Blvd', city: 'Garland', zip_code: '75040', county: 'Dallas',
    lat: 32.9012, lng: -96.6534, price: 98000, estimated_value: 175000,
    bedrooms: 3, bathrooms: 2, sqft: 1560, lot_size_sqft: 8600, year_built: 1985,
    property_type: 'SFR', sale_type: 'Foreclosure', status: 'Active',
    auction_date: '2026-05-05', list_date: '2026-04-04',
    source: 'Dallas County Clerk', source_id: 'DC-2026-GA-05512',
    description: 'Garland 3/2 on quiet cul-de-sac street. Needs roof and HVAC. Original interior, strong bones. Good Garland ISD schools nearby.',
    lender: 'LoanDepot', case_number: '2026-FC-GA-05512',
  },
  // DeSoto
  {
    address: '1203 Wintergreen Rd', city: 'DeSoto', zip_code: '75115', county: 'Dallas',
    lat: 32.5912, lng: -96.8612, price: 127000, estimated_value: 218000,
    bedrooms: 4, bathrooms: 2.5, sqft: 2100, lot_size_sqft: 10200, year_built: 1990,
    property_type: 'SFR', sale_type: 'Foreclosure', status: 'Active',
    auction_date: '2026-06-02', list_date: '2026-04-19',
    source: 'Dallas County Clerk', source_id: 'DC-2026-DS-01203',
    description: 'DeSoto 4/2.5, two-story. Master down, formal dining. Needs full cosmetic renovation. Large fenced yard. Good DeSoto ISD. ARV estimates $265-285k after updates.',
    lender: 'Specialized Loan Servicing', case_number: '2026-FC-DS-01203',
  },
  // Lancaster
  {
    address: '804 W Beltline Rd', city: 'Lancaster', zip_code: '75146', county: 'Dallas',
    lat: 32.5923, lng: -96.7701, price: 61000, estimated_value: 112000,
    bedrooms: 3, bathrooms: 1, sqft: 1050, lot_size_sqft: 9800, year_built: 1960,
    property_type: 'SFR', sale_type: 'Tax Sale', status: 'Active',
    auction_date: '2026-05-05', list_date: '2026-04-05',
    source: 'Dallas County Tax Office', source_id: 'TAX-2026-LAN-00804',
    description: 'Tax sale property in Lancaster. Extra large lot - possible lot split opportunity. 3/1 brick, vacant. Back taxes approx $14,500 including penalties.',
    case_number: 'TAX-2026-LAN-00804',
  },
  // Multi-family
  {
    address: '3309 S Beckley Ave', city: 'Dallas', zip_code: '75224', county: 'Dallas',
    lat: 32.7234, lng: -96.8523, price: 148000, estimated_value: 265000,
    bedrooms: null, bathrooms: null, sqft: 2800, lot_size_sqft: 6200, year_built: 1963,
    property_type: 'Multi-Family', sale_type: 'Foreclosure', status: 'Active',
    auction_date: '2026-05-05', list_date: '2026-04-09',
    source: 'Dallas County Clerk', source_id: 'DC-2026-MF-03309',
    description: 'Duplex foreclosure in Oak Cliff. Two 2/1 units, one occupied (month-to-month), one vacant. Combined rental income potential $2,200/mo. Each unit needs cosmetics.',
    lender: 'Quicken/Rocket Mortgage', case_number: '2026-FC-03309',
  },
  // Duncanville
  {
    address: '501 W Camp Wisdom Rd', city: 'Duncanville', zip_code: '75116', county: 'Dallas',
    lat: 32.6489, lng: -96.9089, price: 94000, estimated_value: 163000,
    bedrooms: 3, bathrooms: 2, sqft: 1420, lot_size_sqft: 8800, year_built: 1977,
    property_type: 'SFR', sale_type: 'REO', status: 'Active',
    auction_date: null, list_date: '2026-04-11',
    source: 'HUD Homes', source_id: 'HUD-2026-TX-00501',
    description: 'HUD Home, UI (Uninsured). Cash or renovation loan only. 3/2 brick in Duncanville. Needs HVAC, roof, and kitchen. Duncanville ISD.',
  },
  // Rowlett
  {
    address: '4820 Lakeview Pkwy', city: 'Rowlett', zip_code: '75088', county: 'Dallas',
    lat: 32.9023, lng: -96.5423, price: 143000, estimated_value: 235000,
    bedrooms: 4, bathrooms: 2, sqft: 1950, lot_size_sqft: 8900, year_built: 1989,
    property_type: 'SFR', sale_type: 'Foreclosure', status: 'Active',
    auction_date: '2026-06-02', list_date: '2026-04-21',
    source: 'Dallas County Clerk', source_id: 'DC-2026-RW-04820',
    description: 'Rowlett 4/2, near Lake Ray Hubbard. Updated kitchen (2019). Needs HVAC and master bath. Rowlett ISD, popular suburban market.',
    lender: 'Arvest Bank', case_number: '2026-FC-RW-04820',
  },
];

const insertProp = db.prepare(`
  INSERT INTO properties (
    address, city, state, zip_code, county, lat, lng,
    price, estimated_value, bedrooms, bathrooms, sqft, lot_size_sqft, year_built,
    property_type, sale_type, status, auction_date, list_date,
    source, source_id, description, case_number, trustee, lender, images
  ) VALUES (
    @address, @city, 'TX', @zip_code, @county, @lat, @lng,
    @price, @estimated_value, @bedrooms, @bathrooms, @sqft, @lot_size_sqft, @year_built,
    @property_type, @sale_type, @status, @auction_date, @list_date,
    @source, @source_id, @description, @case_number, @trustee, @lender, '[]'
  )
  ON CONFLICT(source, source_id) DO UPDATE SET
    price=excluded.price,
    status=excluded.status,
    updated_at=datetime('now')
`);

let added = 0;
for (const p of properties) {
  try {
    insertProp.run({
      ...p,
      case_number: p.case_number || null,
      trustee: p.trustee || null,
      lender: p.lender || null,
    });
    added++;
  } catch (e) {
    console.error(`Error seeding ${p.address}:`, e.message);
  }
}

console.log(`Seeded ${added} properties.`);
console.log('\nDefault credentials (CHANGE THESE):');
console.log('  luke / FlipDallas2024!');
console.log('  john / FlipDallas2024!');
console.log('\nChange passwords via: node changePassword.js <username> <newpassword>');
