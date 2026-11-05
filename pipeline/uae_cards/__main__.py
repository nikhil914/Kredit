"""CLI.

  python -m uae_cards crawl --out out/ [--limit 10] [--no-crossref] [--llm] [--render]
  python -m uae_cards parse-file page.html --url https://kredit.ae/credit-cards/<slug>/details [--llm]
  python -m uae_cards sync-site        # merge out/cards_extended.json into ../data/cards.json
  python -m uae_cards schema            # print the strict CreditCard JSON schema
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from .fetch import DEFAULT_UA, FetcherConfig


def _source_for(url: str):
    from .sources.crossref import creditcardfinder, finafy, yallacompare
    from .sources.kredit import KreditSource

    if "kredit.ae" in url:
        return KreditSource()
    for factory in (finafy, creditcardfinder, yallacompare):
        s = factory()
        if s.base.split("//")[1].removeprefix("www.") in url:
            return s
    raise SystemExit(f"no parser for {url}")


def cmd_crawl(a) -> int:
    from .pipeline import RunConfig, run

    cfg = RunConfig(
        out_dir=Path(a.out), limit=a.limit, crossref=not a.no_crossref, llm=a.llm,
        llm_model=a.model, llm_effort=a.effort,
        fetcher=FetcherConfig(user_agent=a.user_agent, min_delay=a.delay, render_js=a.render,
                              cache_dir=Path(a.cache_dir)),
    )
    r = run(cfg)
    print(json.dumps({"cards": len(r.cards), "skipped": len(r.skipped), "errors": len(r.errors),
                      "out": str(cfg.out_dir)}, indent=2))
    return 0 if r.cards else 1


def cmd_parse_file(a) -> int:
    from . import text as T
    from .draft import build

    html = Path(a.file).read_text(encoding="utf-8")
    src = _source_for(a.url)
    d = src.parse(a.url, html)
    if d is None:
        print("could not parse page", file=sys.stderr)
        return 1
    if a.llm:
        from .llm import extract_with_claude
        from .merge import merge
        from .pipeline import llm_draft

        res = extract_with_claude(a.url, T.to_markdown(html), draft=d.known() | {"card_name": d.card_name},
                                  model=a.model, effort=a.effort)
        if res.envelope is None:
            print(f"LLM step failed: {res.error}", file=sys.stderr)
        else:
            d, _ = merge(d, [llm_draft(a.url, res.envelope)])
            d.extra_urls = [u for u in d.extra_urls if u != a.url]
    card, extras, report = build(d)
    print(json.dumps({"card": card.model_dump(mode="json"),
                      "site_extras": extras.model_dump(mode="json"),
                      "report": report.model_dump(mode="json")}, indent=2, ensure_ascii=False))
    return 0


def cmd_sync_site(a) -> int:
    from .sitesync import run_cli

    return run_cli(Path(a.crawl), Path(a.site), Path(a.report) if a.report else None,
                   Path(a.overrides) if a.overrides else None, Path(a.summary), a.run_url)


def cmd_schema(_a) -> int:
    from .schema import CreditCard

    print(json.dumps(CreditCard.model_json_schema(), indent=2))
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="uae_cards")
    p.add_argument("-v", "--verbose", action="store_true")
    sub = p.add_subparsers(dest="cmd", required=True)

    def llm_args(sp):
        sp.add_argument("--llm", action="store_true", help="run the Claude post-processing pass")
        sp.add_argument("--model", default="claude-opus-5-5")
        sp.add_argument("--effort", default="medium", choices=["low", "medium", "high", "xhigh", "max"])

    c = sub.add_parser("crawl", help="crawl kredit.ae (+ cross-reference sites) and write JSON")
    c.add_argument("--out", default="out")
    c.add_argument("--limit", type=int, default=None, help="max kredit.ae detail pages")
    c.add_argument("--no-crossref", action="store_true")
    c.add_argument("--render", action="store_true", help="render every page with Playwright")
    c.add_argument("--delay", type=float, default=4.0, help="min seconds between requests per host")
    c.add_argument("--user-agent", default=DEFAULT_UA, help="identify yourself; include a contact")
    c.add_argument("--cache-dir", default=".cache/html")
    llm_args(c)
    c.set_defaults(fn=cmd_crawl)

    f = sub.add_parser("parse-file", help="parse one saved HTML page (no network)")
    f.add_argument("file")
    f.add_argument("--url", required=True, help="the page's original URL (selects the parser)")
    llm_args(f)
    f.set_defaults(fn=cmd_parse_file)

    y = sub.add_parser("sync-site", help="merge a crawl into the site's data/cards.json (with quality gates)")
    y.add_argument("--crawl", default="out/cards_extended.json")
    y.add_argument("--report", default="out/report.json")
    y.add_argument("--site", default="../data/cards.json")
    y.add_argument("--overrides", default="../data/overrides.json")
    y.add_argument("--summary", default="out/summary.md")
    y.add_argument("--run-url", default=None)
    y.set_defaults(fn=cmd_sync_site)

    s = sub.add_parser("schema", help="print the CreditCard JSON schema")
    s.set_defaults(fn=cmd_schema)

    a = p.parse_args(argv)
    logging.basicConfig(level=logging.INFO if a.verbose else logging.WARNING,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
