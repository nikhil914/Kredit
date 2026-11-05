# uae-cards: UAE credit card scraping + normalization pipeline

Crawls **kredit.ae** (primary), fills gaps from **finafy.ae**, **creditcardfinder.ae** and
**yallacompare.com**, and normalizes every card into one strict Pydantic schema. An optional
Claude pass reads each page's Markdown and returns the same schema plus a list of **hidden
spend criteria** (spend thresholds that gate the advertised rates, bonuses, fee waivers and perks).

```
discover (hub ?page=N, collections, bank pages)
   └─> fetch detail pages (robots.txt checked, 4s+ per host, cached)
         └─> parse (label-based, markup-agnostic) ──> CardDraft
               └─> match + merge cross-reference drafts (kredit.ae wins; conflicts logged)
                     └─> [optional] Claude pass (fills gaps, flags hidden spend criteria)
                           └─> build + validate ──> cards.json / cards_extended.json / report.json
```

## Quick start

```bash
pip install -e '.[dev]'              # core
pip install -e '.[llm]'              # + Claude post-processing
pip install -e '.[render]' && playwright install chromium   # only if pages need JS rendering

# Set a real contact in the user agent before crawling.
python -m uae_cards crawl --out out/ --limit 10 \
  --user-agent "AcmeCardResearch/1.0 (+mailto:you@yourdomain.ae)" -v

python -m uae_cards crawl --out out/ --llm            # with the Claude pass (claude-opus-5-5)
python -m uae_cards parse-file saved.html --url https://kredit.ae/credit-cards/<slug>/details
python -m uae_cards schema                            # JSON schema of CreditCard
pytest -q
```

## Outputs (in `--out`)

| File | Contents |
|---|---|
| `cards.json` / `cards.jsonl` | `CreditCard` records with exactly the spec's fields and nothing else |
| `cards_extended.json` | Same records plus optional site fields: `cashback_rates.international_percent`, `cashback_rates.other_percent`, `first_year_free`, `min_monthly_spend_aed`, `early_cancellation_fee_aed`, `apply_url`, `ecosystem_tags` |
| `report.json` | Per card: `missing_fields`, `inferred_fields`, `conflicts` between sources, `hidden_spend_criteria`, `field_sources`. Also lists skipped (out-of-scope) cards and errors. |
| `pages/<slug>.md` | Compact Markdown of each kredit.ae page (the LLM input; useful for re-runs) |

## Layout

| Module | Role |
|---|---|
| `uae_cards/schema.py` | `CreditCard` (strict, `extra="forbid"`), enums, sidecar models (`HiddenSpendCriterion`, `SiteExtras`, `CardReport`) |
| `uae_cards/normalize.py` | Pure parsers: AED/percent, monthly rate (APR to monthly), bank/tier/network/Islamic detection, reward types, cashback categories, fee flags, valet locations, hidden spend detector |
| `uae_cards/text.py` | HTML to text lines, label/value pair extraction (tables, `<dl>`, `Label: value`, label-line/value-line), sections, Markdown for the LLM |
| `uae_cards/fetch.py` | `PoliteFetcher`: robots.txt (Protego), per-host throttle + Crawl-delay, 429/503 back-off with Retry-After, disk cache, optional Playwright |
| `uae_cards/sources/kredit.py` | kredit.ae discovery + detail parser |
| `uae_cards/sources/crossref.py` | finafy / creditcardfinder / yallacompare discovery + generic parser |
| `uae_cards/merge.py` | Bank + tier gated fuzzy matching; gap-fill merge with conflict log |
| `uae_cards/llm.py` | Claude structured-output extraction, re-validated with Pydantic |
| `prompts/card_extraction.md` | The LLM post-processing prompt (usable on its own with any model) |

## Normalization decisions

- **Unknown means `null`.** No field is guessed. `annual_fee_aed`, `network`, `tier`, rates and salary are nullable; `report.json` lists every gap.
- **bank_name**: Liv. maps to ENBD; RAKislamic to RAKBANK; Mashreq Al Islami to Mashreq. Issuers outside the enum (CBI, Al Ansari, Deem, Dubai First, ...) and debit/prepaid cards are skipped and listed under `skipped`.
- **is_islamic**: true for ADIB/DIB/EI, or on Islamic / Covered Card / Murabaha / Tawarruq / profit-rate wording.
- **tier** comes from the card name ("World Elite" before "World"; "Gold" maps to Classic). **network** comes from the name, then explicit phrases ("Visa Infinite"), then the tier (Infinite/Signature imply Visa; World/World Elite/Titanium imply Mastercard). Inferred values are marked in `inferred_fields`. "Visa services" (a visa-processing perk) is not read as the Visa network.
- **fx_fee_percent** = FX fee + scheme fee when both are listed. kredit.ae quotes one "International Transaction Fee (non-AED)" figure; it is used as all-in and flagged as such.
- **monthly_interest_rate_percent** is the monthly purchase rate; APR-only pages are divided by 12 and flagged. Values above 10 fail validation (that is an APR).
- **is_free_for_life** only for unconditional "free"/"no annual fee"; a first-year waiver or a spend-based waiver goes to `annual_fee_waiver_condition`.
- **cashback_rates** take the highest stated % per category; miles/points rows are ignored. International and base ("all other spend") rates go to the extended file.
- **Hidden spend criteria** are detected by regex in every run and, with `--llm`, by the model too. Each has `applies_to`, `min_spend_aed`, `period`, `window_days`, a quote, and `prominently_disclosed` (true only if the headline/summary area states it as a spend condition).

## Politeness and terms

- robots.txt is enforced for every URL (Google-style longest match). As of 2026-11-02: kredit.ae allows `/credit-cards?page=N` but disallows other query URLs, `/api/`, and apply/learn-more/"go" links; finafy.ae disallows `/card-details/`, `/compare/`, `/api/`; creditcardfinder.ae and yallacompare.com do not restrict card pages. If robots.txt returns 5xx or fails, the host is treated as fully disallowed.
- One request at a time per host, at least 4 s apart plus jitter (`--delay`), with a 400 request budget per host. Cross-reference detail pages are fetched only when their URL plausibly matches a kredit.ae card.
- Apply links are recorded, never fetched.
- **Read each site's Terms of Use before running this on a schedule or publishing the data.** robots.txt permission is not a licence to republish. For commercial use, ask kredit.ae for a data feed or permission, and verify fees against the banks' Key Facts Statements (the parser records KFS links in `source_urls`).

## Known limits

- The selectors are label-based and were written from kredit.ae's visible page text plus the URL patterns of all four sites. The build sandbox could not reach the sites directly, so the test fixtures are hand-written to mirror the observed labels. Run `crawl --limit 5 -v` first and check `report.json`: missing fields across many cards mean a label changed. Fix it in `sources/base.py:LABELS` or the source module.
- The finafy / creditcardfinder / yallacompare parsers are generic (label aliases). They fill gaps; they are not trusted over kredit.ae.
- If a page is client-rendered and the static HTML has no content, the pipeline retries it once with Playwright (needs the `render` extra).
