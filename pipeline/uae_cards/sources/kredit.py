"""kredit.ae — primary source.

URL patterns (checked 2026-11-02):
  hub          /credit-cards            (24 cards/page, ?page=2..N; robots allows these)
  collections  /credit-cards/{collection}   e.g. no-annual-fee, cashback, salary5000, travel
  bank pages   /banks/{bank}
  detail       /credit-cards/{card-slug}/details
  never fetch  apply / learn-more / "go" links, /api/, any other ?query URL (robots.txt)

Detail pages are labelled blocks: "At a glance", "Welcome offer", "Rewards", "Eligibility",
"Additional Benefits", "Fees", "Important Stuff", ... with label/value lines such as
"Minimum Salary" / "AED 12,000" and "Monthly Purchase Rate" / "3.69%".
"""

from __future__ import annotations

import logging
import re
from typing import Optional
from urllib.parse import urljoin, urlsplit

from .. import normalize as N
from .. import text as T
from ..draft import CardDraft
from ..fetch import PoliteFetcher, RobotsDisallowed
from .base import ALL_LABELS, benefits_from_lines, generic_extract, rate_rows

log = logging.getLogger(__name__)

BASE = "https://kredit.ae"
HUB = f"{BASE}/credit-cards"
COLLECTIONS = [
    "best-credit-cards", "no-annual-fee", "cashback", "salary5000", "welcome-bonus", "travel",
]
BANK_PAGES = ["enbd", "fab", "adcb", "adib", "mashreq", "hsbc", "citi", "rakbank", "dib",
              "emirates-islamic", "cbd"]

DETAIL_RE = re.compile(r"^/credit-cards/([a-z0-9-]+)/details/?$")
PAGE_RE = re.compile(r"[?&]page=(\d+)")
NON_COLLECTION = {"calculators", "calculator", "compare", "how-we-rank", "most-beautiful-credit-cards"}

SECTION_HEADINGS = [
    "At a glance", "Welcome offer", "Top benefits", "Fees and eligibility", "Rewards",
    "Rewards Calculator", "Eligibility", "Offers", "Additional Benefits", "Fees", "Important Stuff",
    "Kredit rating", "Frequently Asked Questions", "Compare head-to-head", "Similar cards",
    "Other credit cards from this bank", "Related Articles", "Related Collections",
]


class KreditSource:
    name = "kredit.ae"

    def __init__(self, max_hub_pages: int = 20):
        self.max_hub_pages = max_hub_pages

    # -- discovery --------------------------------------------------------------

    @staticmethod
    def detail_links(html: str, base: str = BASE) -> list[str]:
        soup = T.soupify(html)
        out = []
        for href, _ in T.links(soup, base):
            p = urlsplit(href)
            if p.netloc.endswith("kredit.ae") and DETAIL_RE.match(p.path):
                out.append(f"{BASE}{p.path.rstrip('/')}")
        return list(dict.fromkeys(out))

    @staticmethod
    def max_page(html: str) -> int:
        nums = [int(n) for n in PAGE_RE.findall(html)]
        return max(nums) if nums else 1

    @staticmethod
    def collection_links(html: str) -> list[str]:
        soup = T.soupify(html)
        out = []
        for href, _ in T.links(soup, BASE):
            p = urlsplit(href)
            if not p.netloc.endswith("kredit.ae") or p.query:
                continue
            m = re.match(r"^/credit-cards/([a-z0-9-]+)/?$", p.path)
            if m and m.group(1) not in NON_COLLECTION:
                out.append(f"{BASE}{p.path.rstrip('/')}")
        return list(dict.fromkeys(out))

    def discover(self, fetcher: PoliteFetcher) -> list[str]:
        found: list[str] = []

        def harvest(url: str) -> Optional[str]:
            try:
                res = fetcher.get(url)
            except RobotsDisallowed:
                log.info("robots.txt disallows %s, skipping", url)
                return None
            if res.status != 200:
                log.warning("%s -> HTTP %s", url, res.status)
                return None
            found.extend(self.detail_links(res.text))
            return res.text

        hub = harvest(HUB)
        if hub:
            last = min(self.max_page(hub), self.max_hub_pages)
            for n in range(2, last + 1):
                harvest(f"{HUB}?page={n}")
            seeds = self.collection_links(hub)
        else:
            seeds = []
        for c in COLLECTIONS:
            u = f"{HUB}/{c}"
            if u not in seeds:
                seeds.append(u)
        for u in seeds + [f"{BASE}/banks/{b}" for b in BANK_PAGES]:
            harvest(u)

        urls = list(dict.fromkeys(found))
        kept = [u for u in urls if not N.is_out_of_scope(self.slug(u))]
        log.info("kredit.ae: %d detail URLs (%d out of scope skipped)", len(kept), len(urls) - len(kept))
        return kept

    @staticmethod
    def slug(url: str) -> str:
        m = DETAIL_RE.match(urlsplit(url).path)
        return m.group(1) if m else urlsplit(url).path.strip("/").split("/")[-1]

    # -- parsing ----------------------------------------------------------------

    def parse(self, url: str, html: str) -> Optional[CardDraft]:
        soup = T.soupify(html)
        lines = T.html_to_lines(soup)
        if not lines:
            return None
        slug = self.slug(url)
        name = T.page_title(soup)
        if name:
            # og/title fallback looks like "ENBD Voyager World — 75,000 Miles, No Annual Fee 2026"
            name = re.split(r"\s+[—|–-]\s+", name)[0].strip()
        d = CardDraft(source=self.name, url=url, card_name=name, slug_hint=slug)
        d.bank_label = _bank_label(lines)

        pairs = T.label_pairs(soup, lines, ALL_LABELS)
        generic_extract(d, soup, lines, pairs)

        sec = lambda h: T.section_lines(lines, h, SECTION_HEADINGS)  # noqa: E731
        glance = sec("At a glance")
        d.prominent_text = "\n".join(lines[:12] + glance)

        # Welcome bonus: headline value + its condition (from every "Welcome offer" block).
        welcome_lines = T.section_lines_all(lines, "Welcome offer", SECTION_HEADINGS)
        d.prominent_text += "\n" + "\n".join(welcome_lines)
        headline = d.welcome_bonus
        conds = [l for l in welcome_lines
                 if re.search(r"spend|within|first year|issuance|new to bank|offered|eligible", l, re.I)]
        cond = "; ".join(dict.fromkeys(c.rstrip(".") for c in conds))
        if headline and cond:
            d.set("welcome_bonus", f"{headline} — {cond}")
        elif not headline:
            rest = [l for l in welcome_lines if norm_label_safe(l) not in ("welcome bonus", "welcome offer")]
            if rest:
                d.set("welcome_bonus", "; ".join(dict.fromkeys(rest[:3])))

        # Rewards table -> cashback rates (miles/points rows are ignored for cashback).
        reward_lines = sec("Rewards")
        rows = rate_rows(reward_lines)
        cb = N.parse_cashback_rows(rows)
        if cb:
            d.set("cashback", cb)
        # Cap only from the Rewards section; a page-wide match picks up insurance cover etc.
        d.monthly_cap_aed = N.parse_monthly_cap(" ".join(reward_lines), require_context=False) if cb else None
        rt = N.detect_reward_types(name or slug, " ".join(reward_lines) + " " + (d.welcome_bonus or ""))
        d.set("reward_type", [r.value for r in rt])

        # Additional Benefits: richer text for lounge/cinema/golf/valet + key benefits.
        ab_pairs = benefit_blocks(sec("Additional Benefits"))
        for label, value in ab_pairs:
            ll = label.lower()
            if "lounge" in ll:
                d.set("lounge_access", value)
            elif CINEMA_TITLE_RE.search(ll):
                d.set("cinema_offers", value)
            elif "golf" in ll:
                d.set("golf_access", N.perk_present(value))
            elif "valet" in ll:
                d.set("valet_parking", N.perk_present(value))
                d.set("valet_locations", N.extract_locations(value))

        if ab_pairs:
            d.set("key_benefits", [_benefit_text(k, v) for k, v in ab_pairs[:5]])
        else:
            top = sec("Top benefits")
            top_pairs = [f"{k}: {v}" for k, v in zip(top[0::2], top[1::2])]
            d.set("key_benefits", top_pairs[:5] or benefits_from_lines(top))

        # Apply link: recorded, never fetched (robots disallows apply pages).
        for href, txt in T.links(soup, url):
            if re.fullmatch(r"apply( now)?", txt, re.I):
                d.set("apply_url", href)
                break

        for href, txt in T.links(soup, url):
            if re.search(r"key facts", txt, re.I):
                d.extra_urls.append(href)
                break
        return d


CINEMA_TITLE_RE = re.compile(r"cinema|movie|vox|reel|roxy|cin[eé]polis|bogo|buy\s*1\s*get\s*1|buy[\s-]one[\s-]get", re.I)
SEE_MORE_RE = re.compile(r"see (the )?full breakdown|see all( rewards)?|learn more", re.I)


def _title_like(line: str) -> bool:
    return len(line) <= 60 and not line.rstrip().endswith(".")


def benefit_blocks(lines: list[str]) -> list[tuple[str, str]]:
    """Additional Benefits blocks are [title, short value, optional long description,
    optional "See full breakdown"]. Returns (title, short value) pairs, deduplicated."""
    out: list[tuple[str, str]] = []
    i = 0
    while i < len(lines):
        title = lines[i]
        if SEE_MORE_RE.fullmatch(title.strip()):
            i += 1
            continue
        if i + 1 >= len(lines) or SEE_MORE_RE.fullmatch(lines[i + 1].strip()):
            break
        value = lines[i + 1]
        i += 2
        # Skip the long description and "See full breakdown" lines until the next title.
        while i < len(lines) and (SEE_MORE_RE.fullmatch(lines[i].strip())
                                  or (len(lines[i]) > len(value) and not _title_like(lines[i]))):
            i += 1
        if (title, value) not in out:
            out.append((title, value))
    return out


def _benefit_text(title: str, value: str, limit: int = 140) -> str:
    """"Title: value", kept within the schema's 140-char limit without cutting mid-word:
    fall back to the value alone, then to its last complete clause."""
    for s in (f"{title}: {value}", value):
        if len(s) <= limit:
            return s
    cut = max(value.rfind(sep, 0, limit) for sep in (". ", "; ", ", ", " after ", " with "))
    return value[:cut].rstrip(" ,;") if cut > 40 else value[:value.rfind(" ", 0, limit)]


def norm_label_safe(s: str) -> str:
    return T.norm_label(s)


def _bank_label(lines: list[str]) -> Optional[str]:
    for line in lines[:40]:
        if line.isupper() and N.detect_bank(line):
            return line
    return None
