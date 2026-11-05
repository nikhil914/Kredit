"""Orchestration: discover -> fetch -> parse -> cross-reference -> (LLM) -> validate -> write."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from . import text as T
from .draft import CardDraft, OutOfScope, build
from .fetch import FetcherConfig, PoliteFetcher, RobotsDisallowed
from .merge import best_match, merge, plausible
from .schema import CardReport, CreditCard, SiteExtras, extended_record
from .sources.crossref import all_crossref_sources
from .sources.kredit import KreditSource

log = logging.getLogger(__name__)


@dataclass
class RunConfig:
    out_dir: Path = Path("out")
    limit: Optional[int] = None
    crossref: bool = True
    skip_sources: tuple[str, ...] = ()
    llm: bool = False
    llm_model: str = "claude-opus-5-5"
    llm_effort: str = "medium"
    fetcher: FetcherConfig = field(default_factory=FetcherConfig)


@dataclass
class RunResult:
    cards: list[CreditCard] = field(default_factory=list)
    extras: list[SiteExtras] = field(default_factory=list)
    reports: list[CardReport] = field(default_factory=list)
    skipped: list[dict] = field(default_factory=list)
    errors: list[dict] = field(default_factory=list)


def _fetch_and_parse(fetcher: PoliteFetcher, source, url: str, errors: list) -> tuple[Optional[CardDraft], Optional[str]]:
    try:
        res = fetcher.get(url)
    except RobotsDisallowed:
        errors.append({"url": url, "error": "robots.txt disallows"})
        return None, None
    except Exception as e:  # noqa: BLE001
        errors.append({"url": url, "error": f"fetch: {e}"})
        return None, None
    if res.status != 200:
        errors.append({"url": url, "error": f"HTTP {res.status}"})
        return None, None
    draft = source.parse(url, res.text)
    if draft is None and not fetcher.cfg.render_js:
        # Content may be client-rendered; one retry through Playwright if installed.
        try:
            res = fetcher.get(url, render=True)
            draft = source.parse(url, res.text)
        except Exception as e:  # noqa: BLE001
            errors.append({"url": url, "error": f"render: {e}"})
    if draft is None:
        errors.append({"url": url, "error": "parse: no content"})
    return draft, res.text


def llm_draft(url: str, env) -> CardDraft:
    """Turn an LLM envelope into a draft so merge() can treat it as one more source."""
    c = env.card
    d = CardDraft(source="llm", url=url, card_name=c.card_name)
    d.set("network", c.network)
    d.set("tier", c.tier)
    d.set("min_salary_aed", c.min_salary_aed)
    d.set("annual_fee_aed", c.annual_fee_aed)
    d.set("is_free_for_life", c.is_free_for_life)
    d.set("annual_fee_waiver_condition", c.annual_fee_waiver_condition)
    d.set("monthly_interest_rate_percent", c.monthly_interest_rate_percent)
    d.set("fx_fee_percent", c.fx_fee_percent)
    d.set("welcome_bonus", c.welcome_bonus)
    d.set("reward_type", list(c.reward_type))
    d.set("key_benefits", list(c.key_benefits))
    lp = c.lifestyle_perks
    d.set("lounge_access", lp.lounge_access)
    d.set("cinema_offers", lp.cinema_offers)
    d.set("golf_access", lp.golf_access or None)
    d.set("valet_parking", lp.valet_parking or None)
    d.set("valet_locations", list(lp.valet_locations))
    cb = {k: v for k, v in c.cashback_rates.model_dump().items() if v is not None and k != "monthly_cap_aed"}
    ex = env.site_extras
    if ex.cashback_international_percent is not None:
        cb["international"] = ex.cashback_international_percent
    if ex.cashback_other_percent is not None:
        cb["other"] = ex.cashback_other_percent
    d.cashback = cb or None
    d.set("monthly_cap_aed", c.cashback_rates.monthly_cap_aed)
    d.set("first_year_free", ex.first_year_free)
    d.set("early_cancellation_fee_aed", ex.early_cancellation_fee_aed)
    d.set("apply_url", ex.apply_url)
    d.hidden_spend = list(env.hidden_spend_criteria)
    for f in env.inferred_fields:
        d.inferred[f.field] = f.reason
    return d


def run(cfg: RunConfig) -> RunResult:
    out = RunResult()
    cfg.out_dir.mkdir(parents=True, exist_ok=True)
    pages_dir = cfg.out_dir / "pages"
    pages_dir.mkdir(exist_ok=True)

    with PoliteFetcher(cfg.fetcher) as fetcher:
        kredit = KreditSource()
        urls = kredit.discover(fetcher)
        if cfg.limit:
            urls = urls[: cfg.limit]

        primaries: list[tuple[CardDraft, str]] = []
        for url in urls:
            d, html = _fetch_and_parse(fetcher, kredit, url, out.errors)
            if d:
                primaries.append((d, html))
                (pages_dir / f"{kredit.slug(url)}.md").write_text(T.to_markdown(html), encoding="utf-8")

        secondaries: list[CardDraft] = []
        if cfg.crossref:
            for src in all_crossref_sources():
                if src.name in cfg.skip_sources or src.name.split(".")[0] in cfg.skip_sources:
                    continue
                try:
                    s_urls = src.discover(fetcher)
                except Exception as e:  # noqa: BLE001
                    out.errors.append({"source": src.name, "error": f"discover: {e}"})
                    continue
                # Only fetch detail pages that plausibly match a kredit card (saves requests).
                for su in s_urls:
                    slug_text = " ".join(su.rstrip("/").split("/")[-2:]).replace("-", " ")
                    if not plausible(slug_text, [p for p, _ in primaries]):
                        continue
                    d, _ = _fetch_and_parse(fetcher, src, su, out.errors)
                    if d:
                        secondaries.append(d)

    for d, html in primaries:
        conflicts: list[dict] = []
        matched = []
        pool = list(secondaries)
        while True:
            m = best_match(d, pool)
            if not m:
                break
            matched.append(m)
            pool = [p for p in pool if p.source != m.source]  # one match per source
        if matched:
            d, conflicts = merge(d, matched)

        warnings: list[str] = []
        if cfg.llm:
            from .llm import extract_with_claude

            res = extract_with_claude(d.url, T.to_markdown(html), draft=d.known() | {"card_name": d.card_name},
                                      model=cfg.llm_model, effort=cfg.llm_effort)
            if res.envelope is None:
                out.errors.append({"url": d.url, "error": f"llm: {res.error}"})
            elif res.envelope.out_of_scope:
                out.skipped.append({"url": d.url, "reason": "llm: out of scope", "warnings": res.envelope.warnings})
                continue
            else:
                d, llm_conflicts = merge(d, [llm_draft(d.url, res.envelope)])
                d.extra_urls = [u for u in d.extra_urls if u != d.url]
                for u in res.envelope.card.source_urls:
                    if u not in d.extra_urls and u != d.url:
                        d.extra_urls.append(u)
                conflicts += llm_conflicts
                warnings = res.envelope.warnings

        try:
            card, extras, report = build(d)
        except OutOfScope as e:
            out.skipped.append({"url": d.url, "reason": str(e)})
            continue
        except Exception as e:  # noqa: BLE001  (pydantic ValidationError etc.)
            out.errors.append({"url": d.url, "error": f"validate: {e}"})
            continue
        report.conflicts = conflicts + [{"warning": w} for w in warnings]
        out.cards.append(card)
        out.extras.append(extras)
        out.reports.append(report)

    write_outputs(cfg.out_dir, out)
    return out


def write_outputs(out_dir: Path, r: RunResult) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    cards = [c.model_dump(mode="json") for c in r.cards]
    (out_dir / "cards.json").write_text(json.dumps(cards, indent=2, ensure_ascii=False), encoding="utf-8")
    with (out_dir / "cards.jsonl").open("w", encoding="utf-8") as f:
        for c in cards:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")
    ext = [extended_record(c, e) for c, e in zip(r.cards, r.extras)]
    (out_dir / "cards_extended.json").write_text(json.dumps(ext, indent=2, ensure_ascii=False), encoding="utf-8")
    report = {
        "cards": [x.model_dump(mode="json") for x in r.reports],
        "skipped": r.skipped,
        "errors": r.errors,
        "summary": {
            "cards": len(r.cards),
            "skipped": len(r.skipped),
            "errors": len(r.errors),
            "cards_with_hidden_spend_criteria": sum(1 for x in r.reports if x.hidden_spend_criteria),
        },
    }
    (out_dir / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
