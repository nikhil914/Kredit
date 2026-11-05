import copy
import json
from pathlib import Path

from uae_cards.sitesync import run_cli, sync

SITE = Path(__file__).resolve().parents[2] / "data" / "cards.json"


def card(i, bank="ENBD", fee=100, **kw):
    c = {"id": i, "card_name": i.title(), "bank_name": bank, "annual_fee_aed": fee,
         "fx_fee_percent": 2.0, "key_benefits": ["a"], "cashback_rates": {"dining_percent": 5, "fuel_percent": None}}
    c.update(kw)
    return c


def test_unchanged_crawl_is_no_change():
    site = [card(f"c{n}") for n in range(10)]
    res = sync(site, copy.deepcopy(site), today="2026-11-08")
    assert res.ok and not res.changed


def test_nulls_keep_old_values_and_extras_survive():
    site = [card("a", art={"from": "#000000", "to": "#ffffff"})]
    new = card("a", fee=None, key_benefits=[], cashback_rates={"dining_percent": None, "fuel_percent": 1})
    res = sync(site, [new], today="2026-11-08")
    c = res.cards[0]
    assert c["annual_fee_aed"] == 100 and c["key_benefits"] == ["a"] and c["art"]
    assert c["cashback_rates"] == {"dining_percent": 5, "fuel_percent": 1}
    assert c["last_verified"] == "2026-11-08"
    assert res.changes == [("a", "cashback_rates.fuel_percent", None, 1)]


def test_missing_cards_are_hidden_and_new_cards_added():
    site = [card(f"c{n}") for n in range(20)]
    crawl = copy.deepcopy(site[1:]) + [card("new")]
    res = sync(site, crawl)
    assert res.ok
    assert res.hidden == ["c0"] and res.added == ["new"]
    assert next(c for c in res.cards if c["id"] == "c0")["hidden"] is True


def test_hidden_drafts_stay_hidden():
    site = [card(f"c{n}") for n in range(10)] + [card("draft", hidden=True)]
    res = sync(site, copy.deepcopy(site[:10]) + [card("draft")])
    assert next(c for c in res.cards if c["id"] == "draft")["hidden"] is True
    assert res.still_hidden == ["draft"]


def test_overrides_win():
    site = [card("a")]
    res = sync(site, [card("a", fee=300)], overrides={"a": {"annual_fee_aed": 0, "cashback_rates": {"fuel_percent": 2}}})
    c = res.cards[0]
    assert c["annual_fee_aed"] == 0 and c["cashback_rates"] == {"dining_percent": 5, "fuel_percent": 2}


def test_gates():
    site = [card(f"c{n}") for n in range(10)] + [card("h", bank="HSBC")]
    assert any("found 5 of 11" in f for f in sync(site, site[:5]).failures)
    assert any("HSBC" in f for f in sync(site, site[:10]).failures)
    lost = [card(f"c{n}", fee=None) for n in range(10)] + [site[10]]
    assert any("annual_fee_aed" in f for f in sync(site, lost).failures)
    report = {"summary": {"cards": 11, "errors": 9}}
    assert any("pages failed" in f for f in sync(site, site, report).failures)


def test_cli_writes_nothing_on_failure(tmp_path):
    site = [card(f"c{n}") for n in range(10)]
    (tmp_path / "site.json").write_text(json.dumps(site))
    (tmp_path / "crawl.json").write_text(json.dumps(site[:2]))
    code = run_cli(tmp_path / "crawl.json", tmp_path / "site.json", None, None, tmp_path / "s.md")
    assert code == 1
    assert json.loads((tmp_path / "site.json").read_text()) == site
    assert "refresh failed" in (tmp_path / "s.md").read_text()


def test_real_site_data_round_trips():
    site = json.loads(SITE.read_text(encoding="utf-8"))
    res = sync(site, copy.deepcopy(site))
    assert res.ok and not res.changed and len(res.cards) == len(site)
