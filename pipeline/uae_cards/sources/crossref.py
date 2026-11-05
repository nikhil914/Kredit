"""Secondary sources used only to fill gaps in kredit.ae records.

All three are parsed with the shared label vocabulary (sources/base.py); selectors are
deliberately label-based so a redesign degrades to "fewer fields filled", not a crash.

robots.txt notes (checked 2026-11-02):
  finafy.ae            disallows /card-details/, /compare/, /api/, ?id= / ?ids=
  creditcardfinder.ae  disallows /wp-admin/ only
  yallacompare.com     disallows car-insurance quote pages and T&C/privacy only
PoliteFetcher re-checks robots.txt at run time, so these notes are informational.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Callable, Optional
from urllib.parse import urlsplit

from .. import normalize as N
from .. import text as T
from ..draft import CardDraft
from ..fetch import PoliteFetcher, RobotsDisallowed
from .base import ALL_LABELS, benefits_from_lines, generic_extract, rate_rows

log = logging.getLogger(__name__)

PAGINATION_RE = re.compile(r"/page/(\d+)/?$|[?&]page=(\d+)")


@dataclass
class CrossRefSource:
    name: str
    base: str
    listing_paths: list[str]
    detail_re: re.Pattern
    bank_from_path: Callable[[re.Match], Optional[str]] = lambda m: None
    max_listing_pages: int = 10
    benefit_headings: tuple[str, ...] = ("Features", "Key Features", "Benefits", "Highlights",
                                         "Card Benefits", "Key benefits")
    _listing_seen: set = field(default_factory=set)

    def _is_detail(self, url: str) -> Optional[re.Match]:
        p = urlsplit(url)
        if not p.netloc.endswith(urlsplit(self.base).netloc.removeprefix("www.")):
            return None
        return self.detail_re.match(p.path)

    def discover(self, fetcher: PoliteFetcher) -> list[str]:
        found: list[str] = []
        queue = [self.base + p for p in self.listing_paths]
        pages = 0
        while queue and pages < self.max_listing_pages * len(self.listing_paths):
            url = queue.pop(0)
            if url in self._listing_seen:
                continue
            self._listing_seen.add(url)
            try:
                res = fetcher.get(url)
            except RobotsDisallowed:
                log.info("%s: robots.txt disallows %s", self.name, url)
                continue
            pages += 1
            if res.status != 200:
                continue
            soup = T.soupify(res.text)
            for href, _ in T.links(soup, url):
                href = href.split("#")[0]
                if self._is_detail(href):
                    found.append(href)
                elif PAGINATION_RE.search(href) and href.startswith(url.split("?")[0].rstrip("/")):
                    queue.append(href)
        out = list(dict.fromkeys(found))
        log.info("%s: %d detail URLs", self.name, len(out))
        return out

    def parse(self, url: str, html: str) -> Optional[CardDraft]:
        soup = T.soupify(html)
        lines = T.html_to_lines(soup)
        name = T.page_title(soup)
        if not name or not lines:
            return None
        name = re.split(r"\s+[|–—]\s+", name)[0].strip()
        m = self._is_detail(url)
        bank_hint = self.bank_from_path(m) if m else None
        d = CardDraft(source=self.name, url=url, card_name=name,
                      bank_label=bank_hint or _bank_line(lines))
        pairs = T.label_pairs(soup, lines, ALL_LABELS)
        generic_extract(d, soup, lines, pairs)
        d.prominent_text = "\n".join(lines[:15])

        rows = rate_rows(lines)
        cb = N.parse_cashback_rows(rows)
        if cb:
            d.set("cashback", cb)
        rt = N.detect_reward_types(name, " ".join(r for _, r in rows))
        d.set("reward_type", [r.value for r in rt])

        for h in self.benefit_headings:
            sec = T.section_lines(lines, h, self.benefit_headings + ("Fees", "Eligibility", "Documents",
                                                                    "FAQs", "Fees and Charges"))
            if sec:
                d.set("key_benefits", benefits_from_lines(sec))
                break
        return d


def _bank_line(lines: list[str]) -> Optional[str]:
    for line in lines[:30]:
        if len(line) < 60 and N.detect_bank(line):
            return line
    return None


def finafy() -> CrossRefSource:
    return CrossRefSource(
        name="finafy.ae",
        base="https://www.finafy.ae",
        listing_paths=["/credit-cards/", "/credit-cards/cashback/", "/credit-cards/rewards/",
                       "/credit-cards/travel/", "/credit-cards/retail/", "/credit-cards/cobrand/"],
        # /credit-cards/{bank}/{card}/ ; category pages have a single segment.
        detail_re=re.compile(r"^/credit-cards/([a-z0-9-]+)/([a-z0-9-]+)/?$"),
        bank_from_path=lambda m: m.group(1).replace("-", " "),
    )


def creditcardfinder() -> CrossRefSource:
    return CrossRefSource(
        name="creditcardfinder.ae",
        base="https://creditcardfinder.ae",
        listing_paths=["/credit-cards/", "/credit-cards/cashback-credit-cards/",
                       "/credit-cards/free-for-life-credit-cards/", "/credit-cards/travel-credit-cards/",
                       "/credit-cards/reward-point-credit-cards/"],
        # Card pages are singular /credit-card/{Slug}/ ; slugs are mixed case.
        detail_re=re.compile(r"^/credit-card/([A-Za-z0-9-]+)/?$"),
    )


def yallacompare() -> CrossRefSource:
    return CrossRefSource(
        name="yallacompare.com",
        base="https://yallacompare.com",
        listing_paths=["/uae/en/credit-cards/"],
        detail_re=re.compile(r"^/uae/en/credit-cards/([a-z0-9-]+)/?$"),
        benefit_headings=("Features", "Key Features", "Benefits", "Features:"),
    )


def all_crossref_sources() -> list[CrossRefSource]:
    return [finafy(), creditcardfinder(), yallacompare()]
