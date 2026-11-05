import json
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from uae_cards import normalize as N
from uae_cards.draft import OutOfScope, build
from uae_cards.fetch import FetcherConfig, PoliteFetcher, RobotsDisallowed
from uae_cards.merge import best_match, merge
from uae_cards.schema import CreditCard
from uae_cards.sources.crossref import finafy
from uae_cards.sources.kredit import KreditSource

FX = Path(__file__).parent / "fixtures"
VOYAGER_URL = "https://kredit.ae/credit-cards/enbd-voyager-world-credit-card/details"
CASHBACK_URL = "https://kredit.ae/credit-cards/mashreq-example-cashback-platinum-credit-card/details"


def load(name):
    return (FX / name).read_text()


# --- normalize ---------------------------------------------------------------

@pytest.mark.parametrize("text,expected", [
    ("AED 12,000", 12000), ("AED 5,000+", 5000), ("5K AED", 5000), ("Free", 0),
    ("AED 241.5", 242), ("15,000", 15000), ("Dhs 8,000 per month", 8000), (None, None),
])
def test_parse_aed(text, expected):
    assert N.parse_aed(text) == expected


def test_monthly_rate_from_apr():
    assert N.parse_monthly_rate("3.69% per month (44.28% per annum)") == 3.69
    assert N.parse_monthly_rate("41.88% p.a.") == 3.49


@pytest.mark.parametrize("text,bank", [
    ("emirates-islamic-skywards-infinite-credit-card", "EI"),
    ("enbd-voyager-world-credit-card", "ENBD"),
    ("liv-cashback-plus-credit-card", "ENBD"),
    ("Abu Dhabi Islamic Bank", "ADIB"),
    ("rakbank-rakislamic-platinum-credit-card", "RAKBANK"),
    ("cbd-one-credit-card", "CBD"),
    ("Citibank", "Citi"),
    ("cbi-rewards-world-credit-card", None),
])
def test_detect_bank(text, bank):
    b = N.detect_bank(text)
    assert (b.value if b else None) == bank


def test_out_of_scope():
    assert N.is_out_of_scope("al-ansari-prepaid-card")
    assert N.is_out_of_scope("cbi-rewards-world-credit-card")
    assert not N.is_out_of_scope("mashreq-aura-credit-card")


def test_tier_and_network():
    assert N.detect_tier("Mashreq Aura World Elite") == "World Elite"
    assert N.detect_tier("ENBD Voyager World") == "World"
    net, how = N.detect_network("ENBD Voyager World", "OneVasco visa services", N.detect_tier("World"))
    assert net == "Mastercard" and "tier" in how  # 'visa services' must not read as Visa
    assert N.detect_network("FAB Visa Infinite")[0] == "Visa"


def test_islamic():
    assert N.detect_islamic(N.BankName.DIB, "DIB Prime")
    assert N.detect_islamic(N.BankName.RAKBANK, "RAKislamic Platinum")
    assert N.detect_islamic(N.BankName.ADCB, "Covered card with Murabaha")
    assert not N.detect_islamic(N.BankName.ADCB, "ADCB TouchPoints Infinite")


def test_fee_flags():
    assert N.fee_flags("Free for life", None)["is_free_for_life"]
    ff = N.fee_flags("AED 300", "Annual fee waived in the first year.")
    assert not ff["is_free_for_life"] and ff["first_year_free"] and ff["annual_fee_aed"] == 300


def test_cashback_rows():
    rows = [("Groceries & Supermarkets", "5% cashback"), ("Fuel", "3%"), ("Travel", "3 miles per AED"),
            ("All other spend", "1% cashback")]
    assert N.parse_cashback_rows(rows) == {"groceries_percent": 5.0, "fuel_percent": 3.0, "other": 1.0}


def test_spend_criteria():
    c = N.find_spend_criteria("Get 5% cashback when you spend AED 5,000 per month. "
                              "Spend AED 35,000 within 3 months of issuance to earn the welcome bonus.")
    kinds = {(x.applies_to, x.min_spend_aed, x.period) for x in c}
    assert ("cashback_rate", 5000, "monthly") in kinds
    assert ("welcome_bonus", 35000, "first_n_days") in kinds


# --- schema ------------------------------------------------------------------

def test_schema_forbids_extra_and_enforces_rules():
    base = dict(id="x-card", card_name="X", bank_name="FAB", is_islamic=False)
    with pytest.raises(Exception):
        CreditCard(**base, foo=1)
    with pytest.raises(Exception):
        CreditCard(**base, is_free_for_life=True, annual_fee_aed=300)
    with pytest.raises(Exception):
        CreditCard(**base, monthly_interest_rate_percent=44.28)  # APR passed as monthly
    c = CreditCard(**{**base, "bank_name": "DIB"}, key_benefits=list("abcdefg"))
    assert c.is_islamic and len(c.key_benefits) == 5


# --- kredit parsing ------------------------------------------------------------

def test_kredit_voyager():
    d = KreditSource().parse(VOYAGER_URL, load("kredit_voyager_world.html"))
    card, extras, report = build(d)
    assert card.id == "enbd-voyager-world-credit-card"
    assert card.card_name == "ENBD Voyager World"
    assert (card.bank_name, card.tier, card.network) == ("ENBD", "World", "Mastercard")
    assert card.min_salary_aed == 12000
    assert card.annual_fee_aed == 0 and card.is_free_for_life
    assert card.monthly_interest_rate_percent == 3.69
    assert card.fx_fee_percent == 1.99
    assert card.welcome_bonus.startswith("75,000 Voyager Miles")
    assert card.reward_type == ["AirMiles"]
    assert card.lifestyle_perks.golf_access and card.lifestyle_perks.valet_parking
    assert card.lifestyle_perks.valet_locations == ["Abu Dhabi"]
    assert "Travel Pass" in card.lifestyle_perks.lounge_access
    assert card.cashback_rates.groceries_percent is None  # miles card: no cashback
    assert len(card.key_benefits) == 5
    assert "AED 1,575" not in json.dumps(card.model_dump())  # 'Similar cards' must not leak
    assert report.inferred_fields["network"].startswith("implied by tier")
    ws = [c for c in report.hidden_spend_criteria if c.applies_to == "welcome_bonus"]
    assert ws and ws[0].min_spend_aed == 35000 and ws[0].window_days == 90
    assert extras.apply_url.endswith("/apply")


def test_kredit_cashback_hidden_spend():
    d = KreditSource().parse(CASHBACK_URL, load("kredit_cashback_synthetic.html"))
    card, extras, report = build(d)
    cb = card.cashback_rates
    assert (cb.groceries_percent, cb.fuel_percent, cb.dining_percent, cb.utilities_telecom_percent) == (5, 3, 5, 2)
    assert cb.monthly_cap_aed == 300
    assert card.fx_fee_percent == 3.09  # 2.09 FX + 1 scheme
    assert card.annual_fee_aed == 420 and not card.is_free_for_life
    assert "40,000" in card.annual_fee_waiver_condition
    assert card.lifestyle_perks.lounge_access == "None"
    assert extras.cashback_international_percent == 2 and extras.cashback_other_percent == 1
    assert extras.min_monthly_spend_aed == 5000
    assert extras.early_cancellation_fee_aed == 300
    gated = [c for c in report.hidden_spend_criteria if c.min_spend_aed == 5000]
    assert gated and not gated[0].prominently_disclosed  # only in FAQ, not headline


def test_discovery_links():
    html = load("kredit_hub.html")
    links = KreditSource.detail_links(html)
    assert VOYAGER_URL in links and len(links) == 4
    assert KreditSource.max_page(html) == 3
    assert KreditSource.collection_links(html) == ["https://kredit.ae/credit-cards/no-annual-fee"]


# --- cross-reference -------------------------------------------------------------

def test_merge_fills_gaps_and_keeps_primary():
    primary = KreditSource().parse(CASHBACK_URL, load("kredit_cashback_synthetic.html"))
    url = "https://www.finafy.ae/credit-cards/mashreq/example-cashback-platinum/"
    sec = finafy().parse(url, load("finafy_cashback_synthetic.html"))
    assert best_match(primary, [sec]) is sec
    merged, conflicts = merge(primary, [sec])
    card, _, report = build(merged)
    assert card.lifestyle_perks.valet_parking is True
    assert card.lifestyle_perks.valet_locations == ["Mall of the Emirates", "Dubai Mall"]
    assert "VOX" in card.lifestyle_perks.cinema_offers
    assert report.field_sources["valet_parking"] == "finafy.ae"
    assert card.annual_fee_aed == 420 and url in card.source_urls
    assert conflicts == []


def test_tier_gate_blocks_wrong_match():
    from uae_cards.draft import CardDraft
    a = CardDraft(source="k", url="u1", card_name="Mashreq Aura World Elite Credit Card")
    b = CardDraft(source="f", url="u2", card_name="Mashreq Aura Credit Card")
    assert best_match(a, [b]) is None


def test_out_of_scope_raises():
    from uae_cards.draft import CardDraft
    with pytest.raises(OutOfScope):
        build(CardDraft(source="k", url="u", card_name="Al Ansari Prepaid Card", slug_hint="al-ansari-prepaid-card"))


# --- fetcher: robots + politeness ---------------------------------------------

ROBOTS = """User-agent: *
Allow: /credit-cards?page=
Disallow: /*?*
Disallow: /credit-cards/*/apply
Crawl-delay: 0
"""


def _fetcher(handler, **cfg):
    client = httpx.Client(transport=httpx.MockTransport(handler))
    return PoliteFetcher(FetcherConfig(min_delay=0, jitter=0, cache_dir=None, **cfg), client=client)


def test_robots_longest_match():
    def handler(req):
        if req.url.path == "/robots.txt":
            return httpx.Response(200, text=ROBOTS)
        return httpx.Response(200, text="<html><main>ok</main></html>")

    f = _fetcher(handler)
    assert f.allowed("https://kredit.ae/credit-cards?page=2")
    assert not f.allowed("https://kredit.ae/credit-cards?sort=fee")
    assert not f.allowed("https://kredit.ae/credit-cards/x/apply")
    assert f.allowed(VOYAGER_URL)
    with pytest.raises(RobotsDisallowed):
        f.get("https://kredit.ae/credit-cards/x/apply")


def test_robots_5xx_means_disallow():
    f = _fetcher(lambda req: httpx.Response(503))
    assert not f.allowed("https://example.ae/anything")


def test_retry_on_429(monkeypatch):
    monkeypatch.setattr("time.sleep", lambda s: None)
    calls = {"n": 0}

    def handler(req):
        if req.url.path == "/robots.txt":
            return httpx.Response(404)
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429, headers={"Retry-After": "1"})
        return httpx.Response(200, text="ok")

    f = _fetcher(handler)
    assert f.get("https://kredit.ae/credit-cards").status == 200 and calls["n"] == 2


# --- LLM step (no network: fake client) ---------------------------------------

def test_llm_schema_is_closed_and_fully_required():
    from uae_cards.llm import output_schema

    s = output_schema()

    def walk(n):
        if isinstance(n, dict):
            if n.get("type") == "object" and "properties" in n:
                assert n["additionalProperties"] is False
                assert set(n["required"]) == set(n["properties"])
            for k in ("maxItems", "minimum", "pattern", "default"):
                assert k not in n
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)

    walk(s)


def test_llm_extract_with_fake_client():
    from uae_cards.llm import extract_with_claude

    payload = {
        "out_of_scope": False,
        "card": {
            "id": "enbd-voyager-world-credit-card", "card_name": "ENBD Voyager World", "bank_name": "ENBD",
            "is_islamic": False, "network": "Mastercard", "tier": "World", "min_salary_aed": 12000,
            "annual_fee_aed": 0, "is_free_for_life": True, "annual_fee_waiver_condition": None,
            "monthly_interest_rate_percent": 3.69, "fx_fee_percent": 1.99,
            "welcome_bonus": "75,000 Voyager Miles — spend AED 35,000 within 3 months",
            "reward_type": ["AirMiles"], "key_benefits": ["8 lounge visits/year"],
            "lifestyle_perks": {"lounge_access": "8/year", "cinema_offers": None, "golf_access": True,
                                "valet_parking": True, "valet_locations": ["Abu Dhabi"]},
            "cashback_rates": {"groceries_percent": None, "fuel_percent": None, "dining_percent": None,
                               "utilities_telecom_percent": None, "education_percent": None,
                               "monthly_cap_aed": None},
            "source_urls": [VOYAGER_URL],
        },
        "hidden_spend_criteria": [{"applies_to": "welcome_bonus", "min_spend_aed": 35000, "period": "first_n_days",
                                   "window_days": 90, "condition_text": "Spend AED 35,000 within 3 months",
                                   "prominently_disclosed": True, "source_url": None}],
        "site_extras": {"cashback_international_percent": None, "cashback_other_percent": None,
                        "first_year_free": True, "min_monthly_spend_aed": None,
                        "early_cancellation_fee_aed": None, "apply_url": None, "ecosystem_tags": []},
        "inferred_fields": [{"field": "network", "reason": "implied by World tier"}],
        "evidence": [{"field": "min_salary_aed", "quote": "Minimum Salary AED 12,000"}],
        "warnings": [],
    }
    seen = {}

    class FakeMessages:
        def create(self, **kw):
            seen.update(kw)
            return SimpleNamespace(stop_reason="end_turn", usage=None,
                                   content=[SimpleNamespace(type="text", text=json.dumps(payload))])

    client = SimpleNamespace(beta=SimpleNamespace(messages=FakeMessages()))
    res = extract_with_claude(VOYAGER_URL, "# page", client=client)
    assert res.error is None and res.envelope.card.min_salary_aed == 12000
    assert res.envelope.hidden_spend_criteria[0].source_url == VOYAGER_URL
    assert seen["model"] == "claude-opus-5-5"
    assert seen["output_config"]["format"]["type"] == "json_schema"
    assert seen["fallbacks"] == "default"

    bad = dict(payload, card=dict(payload["card"], annual_fee_aed=300))  # FFL with a fee
    payload.clear(); payload.update(bad)
    res = extract_with_claude(VOYAGER_URL, "# page", client=client)
    assert res.envelope is None and "validation" in res.error


# --- end to end (mock network) --------------------------------------------------

def test_run_end_to_end(tmp_path, monkeypatch):
    from uae_cards import pipeline

    hub = """<main>
      <a href="/credit-cards/enbd-voyager-world-credit-card/details">x</a>
      <a href="/credit-cards/mashreq-example-cashback-platinum-credit-card/details">x</a>
      <a href="/credit-cards/al-ansari-prepaid-card/details">x</a></main>"""
    finafy_list = '<main><a href="/credit-cards/mashreq/example-cashback-platinum/">More details</a></main>'
    pages = {
        ("kredit.ae", "/credit-cards"): hub,
        ("kredit.ae", "/credit-cards/enbd-voyager-world-credit-card/details"): load("kredit_voyager_world.html"),
        ("kredit.ae", "/credit-cards/mashreq-example-cashback-platinum-credit-card/details"):
            load("kredit_cashback_synthetic.html"),
        ("www.finafy.ae", "/credit-cards/"): finafy_list,
        ("www.finafy.ae", "/credit-cards/mashreq/example-cashback-platinum/"): load("finafy_cashback_synthetic.html"),
    }
    requested = []

    def handler(req):
        requested.append(str(req.url))
        if req.url.path == "/robots.txt":
            return httpx.Response(200, text=ROBOTS if req.url.host == "kredit.ae" else "User-agent: *\nAllow: /\n")
        html = pages.get((req.url.host, req.url.path))
        return httpx.Response(200, text=html) if html else httpx.Response(404)

    real = pipeline.PoliteFetcher
    monkeypatch.setattr(pipeline, "PoliteFetcher",
                        lambda cfg: real(cfg, client=httpx.Client(transport=httpx.MockTransport(handler))))
    cfg = pipeline.RunConfig(out_dir=tmp_path, fetcher=FetcherConfig(min_delay=0, jitter=0, cache_dir=None))
    r = pipeline.run(cfg)

    assert sorted(c.id for c in r.cards) == ["enbd-voyager-world-credit-card",
                                             "mashreq-example-cashback-platinum-credit-card"]
    cards = json.loads((tmp_path / "cards.json").read_text())
    assert all(set(c) == set(CreditCard.model_fields) for c in cards)  # exact field set
    ext = json.loads((tmp_path / "cards_extended.json").read_text())
    assert "international_percent" in ext[0]["cashback_rates"] and "ecosystem_tags" in ext[0]
    mash = next(c for c in r.cards if c.bank_name == "Mashreq")
    assert mash.lifestyle_perks.valet_parking  # filled from finafy
    assert not any("al-ansari" in u for u in requested)  # out of scope never fetched
    assert not any("/apply" in u for u in requested)
    assert (tmp_path / "pages" / "enbd-voyager-world-credit-card.md").exists()


# --- parser fixes (live kredit.ae layout, 2026-11) ------------------------------

from uae_cards.schema import HiddenSpendCriterion  # noqa: E402
from uae_cards.sources.base import rate_rows  # noqa: E402
from uae_cards.sources.kredit import benefit_blocks  # noqa: E402


def test_benefit_blocks_pair_title_with_short_value():
    lines = [
        "Airport Lounge Access", "8 visits a year via Visa Airport Companion.",
        "8 Visa Airport Companion lounge visits a calendar year for the cardholder, after a USD 1 "
        "foreign-currency transaction at least 10 days before travel.",
        "See full breakdown",
        "Visa Agoda Discounts", "Up to 12% off on select hotel bookings",
        "Buy 1 Get 1 Movie Tickets", "BOGO at Royal Cinemas with 15% food discount",
        "Buy 1 Get 1 free movie tickets at Royal Cinemas (Abu Dhabi). 15% discount on food and beverages.",
        "24/7 Concierge Service", "Personal concierge for errands and bookings",
    ]
    assert benefit_blocks(lines) == [
        ("Airport Lounge Access", "8 visits a year via Visa Airport Companion."),
        ("Visa Agoda Discounts", "Up to 12% off on select hotel bookings"),
        ("Buy 1 Get 1 Movie Tickets", "BOGO at Royal Cinemas with 15% food discount"),
        ("24/7 Concierge Service", "Personal concierge for errands and bookings"),
    ]


def test_tiered_rates_keep_top_tier_and_drop_zero():
    rows = rate_rows(["Category", "Under AED 5,000", "AED 5,000+", "Dining", "0%", "6%",
                      "Grocery", "0%", "3%", "Utilities", "Capped at AED 150 a month", "0%", "0%"])
    cb = N.parse_cashback_rows(rows)
    assert cb == {"dining_percent": 6.0, "groceries_percent": 3.0}


def test_miles_equivalent_percent_is_not_cashback():
    rows = rate_rows(["International", "1 mile per USD", "1.2%", "1 mile per USD",
                      "Noon Food", "0.2 credits per AED", "20%"])
    assert N.parse_cashback_rows(rows) == {}


def test_fx_fee_row_is_not_international_cashback():
    assert N.parse_cashback_rows([("International transaction fee", "1.99%")]) == {}
    assert N.parse_cashback_rows([("International spend", "2% cashback")]) == {"international": 2.0}


def test_monthly_cap_ignores_insurance_and_limits():
    assert N.parse_monthly_cap("Education Protection Plan covering up to AED 500,000 per child per month") is None
    assert N.parse_monthly_cap("Total rewards capped at AED 1,000 a month") == 1000
    assert N.parse_monthly_cap("Capped at AED 150 a month", require_context=False) == 150


def test_min_monthly_spend_excludes_welcome_threshold():
    crit = [
        HiddenSpendCriterion(applies_to="welcome_bonus", min_spend_aed=35000, period="first_n_days",
                             window_days=90, condition_text="Spend AED 35,000 within 3 months of issuance",
                             prominently_disclosed=True, source_url=None),
        HiddenSpendCriterion(applies_to="reward_rate", min_spend_aed=35000, period="statement_cycle",
                             window_days=None, condition_text="Earn 75,000 Miles when you spend AED 35,000 "
                             "within first 3 billing statements", prominently_disclosed=True, source_url=None),
        HiddenSpendCriterion(applies_to="cashback_rate", min_spend_aed=5000, period="monthly",
                             window_days=None, condition_text="Earn 5% cashback when you spend AED 5,000 a month",
                             prominently_disclosed=False, source_url=None),
    ]
    assert N.min_monthly_spend(crit) == 5000
    assert N.min_monthly_spend(crit[:2]) is None


def test_benefit_text_fits_schema_limit():
    from uae_cards.sources.kredit import _benefit_text
    v = ("Get two cinema tickets every month for AED 20 each at Reel, Cine Royal or Star Cinemas "
         "after AED 3,000 monthly spend.")
    s = _benefit_text("Movie Tickets from AED 20", v)
    assert len(s) <= 140 and s == v
    long_v = v + " Offer valid on weekdays and weekends at participating venues only, subject to change."
    s2 = _benefit_text("Movie Tickets from AED 20", long_v)
    assert len(s2) <= 140 and long_v.startswith(s2)
