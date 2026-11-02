# Bitaqa: UAE credit card comparison

Next.js 16 (App Router) + Tailwind CSS 4 + Lucide. Zero-gate: every fee and benefit is visible without a phone number or OTP.

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # static export to out/
```

## Deploy (GitHub Pages)

`.github/workflows/deploy.yml` builds a static export and publishes it on every push to `main`.
One-time setup: repo **Settings > Pages > Source: GitHub Actions**. The site is then served at
`https://<user>.github.io/<repo>/`; the workflow sets the base path automatically.

## Architecture

```
app/
  layout.tsx            Fonts (Inter, Plus Jakarta Sans, IBM Plex Sans Arabic), <html dir>
  page.tsx              Loads data/cards.json -> <StoreProvider> -> <Comparator>
  globals.css           Tailwind v4 @theme tokens (canvas #F8FAFC, navy, emerald), slider styles
components/
  store.tsx             useReducer store: salary, card type, fee filters, ecosystem tags,
                        search, sort, compare list (max 3), modal/drawer state, spend, locale
  Comparator.tsx        Page shell: hero, sidebar + grid, dock, modal, drawer, toast
  SiteHeader.tsx        Brand, calculator button, EN/AR toggle
  FilterSidebar.tsx     Salary slider, Islamic/Conventional toggle, fee checkboxes, ecosystem chips
  MobileFilters.tsx     Bottom sheet wrapper for the sidebar on < lg screens
  TopBar.tsx            Search, sort, calculator CTA, result count, removable filter chips
  CardTile.tsx          Card artwork, bank badge, Islamic badge, 3 hero metrics, top-3 perks
                        with cap highlighting, Hidden Fees X-Ray accordion, Compare + Apply CTAs
  CardArt.tsx           CSS-only card artwork (ID-1 ratio, EMV chip, network mark), bank monogram
  CompareDock.tsx       Floating glassmorphism dock, 3 slots
  CompareModal.tsx      Side-by-side table, best value green / worst red per row
  SpendCalculator.tsx   Drawer: 7 spend categories, presets, live top-5 ranking with breakdown
lib/
  types.ts              Card type = scraper Pydantic schema + optional UI extensions
  cards.ts              Bank metadata, tag derivation, fee categories, rewards maths, filters, sort
  i18n.ts               English + Arabic dictionaries
data/
  cards.json            10 cards (mock, indicative)
```

## Behaviour

- **Salary slider** (AED 5,000 to 50,000+): cards above the salary are greyed out with a "Requires AED X" badge, sorted last, and their Apply button is disabled. They are never hidden.
- **Card type, fee, ecosystem tag and search filters** remove cards. Ecosystem tags match any selected tag.
- **Compare**: up to 3 cards; a 4th shows a toast. The modal ranks numeric rows (lower is better for salary, fees, rates; higher for rewards, caps, perks).
- **Spend calculator**: net annual value = 12 x monthly rewards - ongoing annual fee - FX fee on international spend.
  - Category rewards share the card's `monthly_cap_aed`; the base `other_percent` on "everything else" is uncapped.
  - Below `min_monthly_spend_aed`, every category earns only the base rate.
  - Entering spend switches the grid sort to "Highest net AED value" and shows rank badges.
- **RTL**: the toggle sets `<html lang dir>`; layout uses logical utilities (`ps-`, `pe-`, `start-`, `end-`, `text-start`). The choice is remembered in localStorage.

## Data contract

`lib/types.ts` mirrors the scraper's Pydantic schema field for field (`id`, `card_name`, `bank_name`, `is_islamic`, `network`, `tier`, `min_salary_aed`, `annual_fee_aed`, `is_free_for_life`, `annual_fee_waiver_condition`, `monthly_interest_rate_percent`, `fx_fee_percent`, `welcome_bonus`, `reward_type`, `key_benefits`, `lifestyle_perks`, `cashback_rates`, `source_urls`). Drop the scraper's JSON array into `data/cards.json` and it renders.

Optional extensions the UI uses when present, with fallbacks:

| Field | Fallback |
| --- | --- |
| `cashback_rates.international_percent`, `other_percent` | base rate / 0 |
| `first_year_free` | parsed from `annual_fee_waiver_condition` |
| `min_monthly_spend_aed`, `early_cancellation_fee_aed` | shown as "None" |
| `ecosystem_tags` | lounge, cinema BOGO, golf and valet are derived from `lifestyle_perks` |
| `apply_url` | `source_urls[0]` |
| `art` | bank colour gradient |

For miles and points cards, `cashback_rates` hold the effective AED value-back %, so they rank fairly against cashback cards.

Key benefits written as `"<perk> - capped at <cap>"` render the cap as a highlighted pill.

## Data accuracy

The 10 cards are real UAE products, but the fees, rates and caps in `data/cards.json` are indicative values for building the UI. Verify them against the bank pages in `source_urls`, or replace the file with the scraper output, before going live.
