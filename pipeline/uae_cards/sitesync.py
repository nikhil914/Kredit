"""Merge a crawl into the site's data/cards.json, with quality gates.

Rules:
  * A value the crawl did not find (null, or an empty list) keeps the site's value.
  * Fields the crawl does not produce (art, hidden, ...) are kept.
  * Cards missing from the crawl are hidden, not deleted. Hidden cards stay
    hidden when they reappear (they may be admin drafts); the summary lists them.
  * data/overrides.json ({card_id: {field: value}}) is applied last, so manual
    corrections survive every refresh.

The gates stop a broken crawl (blocked site, changed page labels) from
replacing good data. When a gate fails nothing is written.
"""

from __future__ import annotations

import copy
import datetime as dt
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

KEY_FIELDS = [
    "annual_fee_aed",
    "is_free_for_life",
    "annual_fee_waiver_condition",
    "monthly_interest_rate_percent",
    "fx_fee_percent",
    "min_salary_aed",
    "first_year_free",
    "welcome_bonus",
    "cashback_rates",
]
NULL_WATCH = ["annual_fee_aed", "monthly_interest_rate_percent", "fx_fee_percent", "min_salary_aed"]
SKIP_DIFF = {"last_verified", "source_urls"}


@dataclass
class Gates:
    min_kept_ratio: float = 0.9      # crawl must find 90% of the cards on the site
    max_error_ratio: float = 0.25    # at most 25% of detail pages may fail
    max_lost_ratio: float = 0.2      # a key field may go missing on at most 20% of cards


@dataclass
class SyncResult:
    cards: list[dict]
    added: list[str] = field(default_factory=list)
    hidden: list[str] = field(default_factory=list)
    still_hidden: list[str] = field(default_factory=list)
    changes: list[tuple[str, str, Any, Any]] = field(default_factory=list)
    kept_old: dict[str, int] = field(default_factory=dict)
    failures: list[str] = field(default_factory=list)
    stats: dict[str, Any] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return not self.failures

    @property
    def changed(self) -> bool:
        return bool(self.added or self.hidden or self.changes)


def _empty(v: Any) -> bool:
    return v is None or (isinstance(v, (list, str)) and len(v) == 0)


def _merge_value(old: Any, new: Any) -> Any:
    if _empty(new):
        return old
    if isinstance(old, dict) and isinstance(new, dict):
        out = dict(old)
        for k, v in new.items():
            out[k] = _merge_value(old.get(k), v)
        return out
    return new


def _deep_apply(base: dict, patch: dict) -> dict:
    out = dict(base)
    for k, v in patch.items():
        out[k] = _deep_apply(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def _flat(prefix: str, v: Any) -> dict[str, Any]:
    if isinstance(v, dict):
        out: dict[str, Any] = {}
        for k, x in v.items():
            out.update(_flat(f"{prefix}.{k}", x))
        return out
    return {prefix: v}


def sync(site: list[dict], crawl: list[dict], report: dict | None = None,
         overrides: dict | None = None, today: str | None = None,
         gates: Gates | None = None) -> SyncResult:
    gates = gates or Gates()
    today = today or dt.date.today().isoformat()
    overrides = overrides or {}
    by_id = {c["id"]: c for c in site}
    crawl_ids = {c["id"] for c in crawl}
    res = SyncResult(cards=[])

    visible = [c for c in site if not c.get("hidden")]
    found = [c for c in visible if c["id"] in crawl_ids]
    res.stats = {"site_visible": len(visible), "crawl_cards": len(crawl), "found_on_site": len(found)}

    # Gate: the crawl must cover most of the site.
    if visible and len(found) < gates.min_kept_ratio * len(visible):
        res.failures.append(
            f"Crawl found {len(found)} of {len(visible)} cards on the site "
            f"(needs {gates.min_kept_ratio:.0%}). The site may be blocking the crawler.")
    banks_before = {c["bank_name"] for c in visible}
    banks_after = {c["bank_name"] for c in crawl}
    for bank in sorted(banks_before - banks_after):
        res.failures.append(f"No cards found for {bank}.")
    if report:
        s = report.get("summary", {})
        attempted = s.get("cards", 0) + s.get("errors", 0)
        if attempted and s.get("errors", 0) > gates.max_error_ratio * attempted:
            res.failures.append(f"{s['errors']} of {attempted} pages failed to fetch or parse.")
        res.stats["errors"] = s.get("errors", 0)

    lost = {f: 0 for f in NULL_WATCH}
    for new in crawl:
        old = by_id.get(new["id"])
        if old is None:
            card = {**new, "last_verified": today}
            res.added.append(new["id"])
        else:
            card = copy.deepcopy(old)
            for k, v in new.items():
                if k == "id":
                    continue
                if _empty(v) and not _empty(old.get(k)):
                    res.kept_old[k] = res.kept_old.get(k, 0) + 1
                    if k in lost:
                        lost[k] += 1
                card[k] = _merge_value(old.get(k), v)
            card["last_verified"] = today
            if old.get("hidden"):
                res.still_hidden.append(new["id"])
        if card["id"] in overrides:
            card = _deep_apply(card, overrides[card["id"]])
        if old is not None:
            a, b = _flat("", old), _flat("", card)
            for k in sorted(set(a) | set(b)):
                name = k.lstrip(".")
                if name.split(".")[0] in SKIP_DIFF or a.get(k) == b.get(k):
                    continue
                res.changes.append((card["id"], name, a.get(k), b.get(k)))
        res.cards.append(card)

    if found:
        for f, n in lost.items():
            if n > gates.max_lost_ratio * len(found):
                res.failures.append(
                    f"`{f}` missing on {n} of {len(found)} cards that had it. A page label may have changed.")

    for old in site:
        if old["id"] in crawl_ids:
            continue
        card = copy.deepcopy(old)
        if not card.get("hidden"):
            card["hidden"] = True
            res.hidden.append(card["id"])
        res.cards.append(card)

    order = {c["id"]: i for i, c in enumerate(site)}
    res.cards.sort(key=lambda c: order.get(c["id"], len(order)))
    return res


def _fmt(v: Any) -> str:
    if v is None:
        return "—"
    s = json.dumps(v, ensure_ascii=False) if not isinstance(v, str) else v
    s = s.replace("|", "\\|").replace("\n", " ")
    return s if len(s) <= 80 else s[:77] + "..."


def summary_markdown(res: SyncResult, names: dict[str, str], run_url: str | None = None) -> str:
    lines = []
    if res.failures:
        lines.append("## Card data refresh failed\n")
        lines += [f"- {f}" for f in res.failures]
        lines.append("\nNothing was changed.")
    else:
        lines.append("## Card data refresh\n")
    s = res.stats
    lines.append(
        f"\nCrawl: {s.get('crawl_cards', 0)} cards, {s.get('errors', 0)} page errors. "
        f"Site: {s.get('site_visible', 0)} visible cards, {s.get('found_on_site', 0)} found again.")
    lines.append(f"\n**{len(res.added)} added, {len(res.hidden)} hidden, "
                 f"{len({c[0] for c in res.changes})} changed ({len(res.changes)} fields).**")
    if res.added:
        lines.append("\n### Added\n")
        lines += [f"- {names.get(i, i)} (`{i}`)" for i in res.added]
    if res.hidden:
        lines.append("\n### Hidden (no longer on the source site)\n")
        lines += [f"- {names.get(i, i)} (`{i}`)" for i in res.hidden]
    if res.still_hidden:
        lines.append("\n### On the source site but hidden here (unhide in admin if wanted)\n")
        lines += [f"- {names.get(i, i)} (`{i}`)" for i in res.still_hidden]
    if res.changes:
        key = [c for c in res.changes if c[1].split(".")[0] in KEY_FIELDS]
        other = [c for c in res.changes if c[1].split(".")[0] not in KEY_FIELDS]
        for title, rows in (("Fee and rate changes", key), ("Other changes", other)):
            if not rows:
                continue
            lines.append(f"\n### {title}\n")
            lines.append("| Card | Field | Old | New |\n| --- | --- | --- | --- |")
            for cid, f, a, b in rows[:150]:
                lines.append(f"| {_fmt(names.get(cid, cid))} | `{f}` | {_fmt(a)} | {_fmt(b)} |")
            if len(rows) > 150:
                lines.append(f"\n{len(rows) - 150} more rows not shown.")
    if res.kept_old:
        kept = ", ".join(f"`{k}` {n}" for k, n in sorted(res.kept_old.items()))
        lines.append(f"\nNot found this run, previous value kept: {kept}.")
    if run_url:
        lines.append(f"\n[Workflow run]({run_url})")
    return "\n".join(lines) + "\n"


def run_cli(crawl_path: Path, site_path: Path, report_path: Path | None, overrides_path: Path | None,
            summary_path: Path, run_url: str | None = None) -> int:
    site = json.loads(site_path.read_text(encoding="utf-8"))
    crawl = json.loads(crawl_path.read_text(encoding="utf-8"))
    report = json.loads(report_path.read_text(encoding="utf-8")) if report_path and report_path.exists() else None
    overrides = (json.loads(overrides_path.read_text(encoding="utf-8"))
                 if overrides_path and overrides_path.exists() else None)
    res = sync(site, crawl, report, overrides)
    names = {c["id"]: c.get("card_name", c["id"]) for c in site + crawl}
    summary_path.write_text(summary_markdown(res, names, run_url), encoding="utf-8")
    if not res.ok:
        return 1
    if res.changed:
        site_path.write_text(json.dumps(res.cards, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return 0
