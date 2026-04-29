# Dallas Foreclosure Tracker

A private web app for tracking distressed properties in Dallas County, TX. Covers foreclosures,
REOs, tax sales, short sales, HUD homes, and more. Updates daily with map + list views and
robust filtering.

## What it tracks

| Sale Type | Source | Description |
|-----------|--------|-------------|
| **Foreclosure** | Dallas County Clerk | Notice of Trustee Sale filings; auctions 1st Tuesday each month |
| **REO** | HUD Homes, Fannie Mae | Bank/government-owned after failed auction |
| **Tax Sale** | Dallas County Tax Office | Properties delinquent on property taxes |
| **Short Sale** | MLS | Lender-approved below-balance sales |
| **HUD** | HUDHomeStore.gov | FHA-insured foreclosures owned by HUD |

## Quick Start (Local)

### Prerequisites
- Node.js 18+
- npm 9+

### 1. Backend setup

```bash
cd dallas-foreclosures/backend
cp .env.example .env
# Edit .env — at minimum change JWT_SECRET to a random string

npm install
node seed.js          # creates DB + demo data
node server.js        # starts API on port 3001
```

### 2. Frontend setup (separate terminal)

```bash
cd dallas-foreclosures/frontend
npm install
npm run dev           # starts on http://localhost:5173
```

Open http://localhost:5173 in your browser.

**Default credentials** (change these!):
- `luke` / `FlipDallas2024!`
- `buddy` / `FlipDallas2024!`

Change passwords:
```bash
cd backend
node changePassword.js luke yourNewPassword
node changePassword.js buddy yourNewPassword
```

### 3. Run your first scrape

```bash
cd backend
node scrapers/index.js
```

This scrapes all sources and geocodes new addresses. Subsequent scrapes run automatically at
**6 AM Central** every day.

---

## Deployment (so both of you can access it from anywhere)

### Option A: Railway (easiest, ~$5/mo)

1. Push this repo to GitHub (make it private)
2. Go to railway.app → New Project → Deploy from GitHub
3. Add environment variables:
   - `JWT_SECRET` = long random string
   - `NODE_ENV` = production
   - `PORT` = 3001
4. Build the frontend first:
   ```bash
   cd frontend && npm run build
   ```
   Commit the `frontend/dist` folder to the repo (or set up build in Railway)
5. Railway auto-deploys on push

### Option B: DigitalOcean Droplet ($6/mo)

```bash
# On the droplet (Ubuntu 22.04):
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs nginx

# Clone your repo
git clone <your-repo> /var/www/dallas-foreclosures
cd /var/www/dallas-foreclosures

# Build frontend
cd frontend && npm install && npm run build
cd ../backend && npm install

# Set up .env
cp .env.example .env
# Edit JWT_SECRET and NODE_ENV=production

# Seed & run
node seed.js
node server.js &   # or use PM2:
# npm install -g pm2
# pm2 start server.js --name dallas-foreclosures
# pm2 save && pm2 startup

# Nginx reverse proxy
sudo nano /etc/nginx/sites-available/dallas-foreclosures
```

Nginx config:
```nginx
server {
    listen 80;
    server_name your-droplet-ip;  # or your domain

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/dallas-foreclosures /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Then share the IP (or domain) with your partner.

### Option C: Tailscale (zero-cost, private network)

Install Tailscale on both phones + computers + the machine running this app.
Access via the machine's Tailscale IP — no public exposure needed.

---

## Filters available

- **Sale type**: Foreclosure, REO, Tax Sale, Short Sale, HUD, Probate
- **Price**: min/max
- **Beds/Baths**: minimum
- **Square footage**: min/max
- **Zip code**: multi-select (all Dallas County zips)
- **City**: Dallas, Irving, Garland, Mesquite, DeSoto, Lancaster, etc.
- **Property type**: SFR, Condo, Multi-Family, Land, Commercial
- **Auction date**: date range
- **Date listed**: date range
- **Has auction scheduled**: yes/no
- **Sort**: price, list date, auction date, sqft, beds

## Map

- Color-coded markers by sale type
- Clusters automatically at lower zoom levels
- Click any marker for a quick preview popup
- "View Details" link in popup opens full property page

## Adding data sources

Drop a new scraper in `backend/scrapers/` that exports an async function returning an array of
property objects, then register it in `backend/scrapers/index.js`. The upsert logic handles
deduplication automatically.

## Texas Foreclosure calendar (1st Tuesdays)

| Month | 2025 | 2026 |
|-------|------|------|
| May   | May 6 | May 5 |
| Jun   | Jun 3 | Jun 2 |
| Jul   | Jul 1 | Jul 7 |
| Aug   | Aug 5 | Aug 4 |
| Sep   | Sep 2 | Sep 1 |
| Oct   | Oct 7 | Oct 6 |
| Nov   | Nov 4 | Nov 3 |
| Dec   | Dec 2 | Dec 1 |
