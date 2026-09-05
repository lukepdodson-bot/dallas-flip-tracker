# Atelier

A rights-and-rails layer that lets painters work from photographers' images with the
licence already attached, and lets buyers commission paintings from a curated photo
library. Licensing, payment splits and tax documents are handled by the platform.

It is **not** a marketplace for finished paintings. Buyers do not pay a premium to see
the photo hung next to the painting. The value is operational: clean rights, seamless
collaboration, money that moves on its own.

## Why the licence is the product

A painting made from someone else's photograph is a derivative work. Since *Warhol
Foundation v. Goldsmith* (2023), the room for fair use in commercial derivative art is
narrower than most painters assume, and a painter working from a found photo usually has
unclear rights without knowing it. What is being sold here is **certainty** — a
pre-cleared grant attached to every image before a brush is loaded.

`backend/services/licenseTemplates.js` holds the clause text. It is a working draft that
encodes the product's intent, not legal advice. **Have an IP attorney draft the
production template before launch.**

## What is built

Leg A — the commission leg — end to end:

| MVP item | Where |
|---|---|
| Photographer onboarding: upload, per-image SKU toggles, floor pricing | `routes/photos.js`, `services/images.js` |
| Painter profiles: portfolio, price range, medium, turnaround | `routes/painters.js` |
| Buyer flow: browse → pick painter → commission → escrow → delivery | `services/commissions.js`, `services/commissionState.js` |
| Stripe Connect split payouts + 1099s | `services/payments.js`, `services/tax.js` |
| Single-use licence PDF signed by all three parties | `services/licenses.js`, `services/pdf.js` |
| Registry entry + certificate on completion | `services/registry.js`, `services/signing.js` |

Plus per-download file tracing (`services/watermark.js`), which the licence depends on to
mean anything.

**Deferred, as scoped:** reference licensing tiers, exclusivity pricing, print
fulfilment, syndication, the reverse brief board. The data model carries every SKU and a
chained provenance record so none of these needs a migration — only `commission`
transacts today, and the SKU endpoint says so when you toggle the others.

## Running it

```bash
# API
cd backend
cp .env.example .env          # set JWT_SECRET; Stripe keys are optional
npm install
npm start                     # http://localhost:4001, seeds demo data on first boot

# Web
cd ../frontend
npm install
npm run dev                   # http://localhost:5174
```

Demo accounts, seeded on an empty database — password `AtelierDemo2026!`:

- `ada@example.com` — photographer, six images in the library
- `marcus@example.com` / `lena@example.com` — painters
- `sam@example.com` — buyer
- `admin@example.com` — admin

```bash
cd backend && npm test        # 71 tests, including the whole leg over HTTP
```

## How the money works

Amounts are integer cents everywhere and rates are basis points. The painter takes the
**remainder** rather than a computed percentage, so platform + photographer + painter
always reconciles exactly to what the buyer paid — no penny stranded in escrow, no
transfer that overdraws the platform balance.

A photographer's per-image floor beats the percentage. A $150 floor earns $150 on a $400
commission, not $40. A price that would leave the painter nothing is refused with the
real minimum, so the buyer can just pay it.

**Escrow** uses separate charges and transfers, not destination charges with manual
capture: an uncaptured PaymentIntent expires after seven days and a painting takes weeks.
The buyer is charged at commission time, funds settle onto the platform balance, and the
transfers to painter and photographer are created when the buyer confirms delivery. The
platform is merchant of record for the leg, which is what makes the splits and the
information returns the platform's job rather than the artists'.

Delivered work left unanswered past its review window is auto-accepted by an hourly
sweep. Escrow cannot sit open because a buyer stopped reading their email.

**No smart contracts.** Stripe Connect already does multi-party payouts in dollars with
tax handling. A chain would add crypto onboarding friction for buyers who want a
painting, and buy nothing.

### Without Stripe keys

With `STRIPE_SECRET_KEY` unset, a deterministic ledger simulator runs the identical
transitions with synthetic ids. The whole flow — escrow, splits, payouts, 1099 totals —
is exercisable offline, which is how the test suite runs. `/health` says which mode you
are in.

## The certificate

Every completed work gets a signed registry entry naming both creators, the licence and
the provenance. Entries are Ed25519 signatures over the SHA-256 of a canonical JSON form
(keys sorted, no insignificant whitespace), so a third party can reproduce the exact
bytes that were signed. Verification recomputes the digest from the stored record rather
than trusting the stored digest, so an edited database row fails the check.

`GET /api/registry/key` publishes the public key. `GET /api/registry/:id` verifies
without an account — a certificate only members can check is not provenance, it is a
claim.

It is marketed as provenance, **not** as an investment wrapper, and nothing buyer-facing
says NFT. Verisart and Arcual are the unglamorous precedent.

**Explicitly out of scope: token-enforced resale royalties.** A token cannot compel a
physical painting to move with it — the canvas sells at an estate sale while the token
sits in a wallet. Enforcement collapsed even in pure-digital markets once Blur removed
royalties and OpenSea made them optional in 2023, and there is no US resale right, so
this would be engineering a royalty the law does not grant. Resale is meant to be
captured by giving the buyer a free authenticated resale listing; the registry already
supports chained `resale` entries, and the listing surface itself is deferred with the
rest of Leg B.

## File protection

- **RAW is never delivered.** Rejected at upload by extension *and* magic bytes. Painters
  do not need sensor data; a full-resolution JPEG or TIFF is more useful because the
  photographer's own colour and tonal decisions are baked in.
- **No visible watermark for painters.** A visible mark destroys the edge detail and
  value structure they are licensing a good image to get.
- **Per-download identifiers.** Each delivered file carries an identifier unique to that
  download, recorded against the licensee, and signed — so a forged mark cannot pin a
  leak on an innocent account. `POST /api/registry/trace` takes a file found in the wild
  and names the account it was delivered to. Only that image's photographer, or an admin,
  can run it.
- The full-resolution file is never served by browsing. The library shows a display copy,
  and the licensed file unlocks only against an executed licence naming the requester.

### Known limits, stated plainly

**The mark is container metadata** (a JPEG APP11 segment, a PNG tEXt chunk). It survives
copying, re-hosting and most CDNs, but a re-encode or a metadata-stripping tool removes
it. It raises the cost of casual leaking; it does not stop a determined leaker.
Production needs a forensic watermark in the frequency domain — Digimarc, Imatag, or a
DCT implementation over a decoded bitmap. `embed()`/`extract()` in
`services/watermark.js` are the seam: replace those two functions and the ledger,
delivery route and trace endpoint are unchanged.

**Rendition generation needs an image pipeline.** `sharp` is an optional dependency. With
it, display and thumbnail copies are derived on upload. Without it, the photographer
uploads their own display copy and the photo cannot be published until they do — nothing
pretends to have resized an image it could not open.

**1099 thresholds move.** The 1099-NEC threshold rose from $600 to $2,000 for payments
after 2025-12-31. Both figures are configuration, and the threshold actually applied is
stored on every generated document so a later change never silently rewrites last year's
answer. In production Stripe files; this module produces the platform's own reconciled
statement, which is what you check that filing against. Confirm the current figure with
a CPA.

## Layout

```
backend/
  db/           schema + a sql.js wrapper with batched persistence
  routes/       auth, photos, painters, commissions, registry, tax, stripe webhooks
  services/
    money             splits, floors, the minimum viable price
    commissionState   the lifecycle as one table of transitions and who may take them
    commissions       orchestration: quote, fund, sign, deliver, accept, settle, refund
    payments          Stripe Connect, plus the ledger simulator
    licenses          issue, execute, render
    registry          signed entries, verification, provenance chain
    watermark         per-download identifiers, embed and extract
    tax               annual statements from our own payout rows
    pdf               a small PDF writer, so licence bytes are stable and hashable
  test/         71 tests
frontend/       React + Vite + Tailwind
```

The PDF writer is hand-rolled rather than pulled from npm because the licence and the
certificate *are* the product: they need to be byte-stable so their hashes mean
something, and neither needs images, embedded fonts, or layout beyond a single column.

## Open questions this does not answer

Straight from the brief, still unresolved and worth resolving with users rather than code:

- Does a curated library convert better than customer-uploaded photos?
- Will photographers list at all, or does file-security anxiety kill supply? Per-image
  SKU control is the mitigation; whether it is enough is untested.
- Is the photographer a real supply constraint or a nice-to-have? **Run one deal manually
  before leaning on any of this.**
- Adjacent markets on the same rails: illustrators, muralists and tattoo artists all work
  from photos and share the clearance problem.
