"""Shared label vocabulary + generic detail-page extraction used by every source."""

from __future__ import annotations

import re
from typing import Iterable, Optional, Protocol

from bs4 import BeautifulSoup

from .. import normalize as N
from .. import text as T
from ..draft import CardDraft
from ..fetch import PoliteFetcher

# Label aliases seen across kredit.ae, finafy.ae, creditcardfinder.ae, yallacompare.com.
LABELS: dict[str, list[str]] = {
    "annual_fee": ["Annual Fee", "Annual Fees", "Yearly Fee", "Annual fee (AED)", "Annual Membership Fee"],
    "joining_fee": ["Joining Fee", "Joining fee"],
    "annual_fee_benefits": ["Annual fee benefits", "Annual Fee Waiver", "Fee waiver"],
    "min_salary": ["Minimum Salary", "Minimum Income", "Min. Salary", "Minimum monthly salary",
                   "Minimum Monthly Income", "Salary Requirement", "Min Salary"],
    "interest": ["Monthly Purchase Rate", "Interest Rate", "Monthly Interest Rate", "Purchase Rate",
                 "Monthly Profit Rate", "Profit Rate", "Rate", "Interest rate per month"],
    "fx_fee": ["International Transaction Fee (non-AED)", "Foreign Currency Transaction Fee",
               "Foreign Transaction Fee", "Foreign Currency Fee", "International Transaction Fee",
               "FX Fee", "Cross Border Fee", "Overseas Transaction Fee"],
    "scheme_fee": ["Scheme Fee", "Network Fee", "Card Scheme Fee", "Visa/Mastercard Fee"],
    "welcome": ["Welcome bonus", "Welcome offer", "Sign-up offer", "Sign up offers", "Sign-up offers",
                "Joining bonus", "Welcome Benefit"],
    "lounge": ["Airport lounge", "Airport lounge access", "Lounge access", "Airport Lounges"],
    "cinema": ["Cinema", "Movie benefits", "Cinema offers", "Movies", "Entertainment"],
    "golf": ["Golf", "Golf access", "Complimentary golf"],
    "valet": ["Valet parking", "Valet", "Complimentary valet parking"],
    "early_cancellation": ["Early Cancellation Fee", "Card Cancellation Fee", "Early Termination Fee",
                           "Early closure fee", "Cancellation Fee"],
    "cashback_cap": ["Cashback cap", "Maximum cashback", "Monthly cap", "Cashback Limit"],
    "card_type": ["Card Type", "Card Network", "Network", "Card Scheme"],
}

ALL_LABELS = [a for v in LABELS.values() for a in v]


class Source(Protocol):
    name: str

    def discover(self, fetcher: PoliteFetcher) -> list[str]: ...
    def parse(self, url: str, html: str) -> Optional[CardDraft]: ...


def first(pairs, key: str) -> Optional[str]:
    return T.lookup(pairs, LABELS[key])


def generic_extract(d: CardDraft, soup: BeautifulSoup, lines: list[str],
                    pairs: list[tuple[str, str]]) -> CardDraft:
    """Fill a draft from (label, value) pairs and free text. Source parsers call this and
    then override with anything site-specific."""
    body = "\n".join(lines)
    d.full_text = body

    # Salary
    d.set("min_salary_aed", N.parse_aed(first(pairs, "min_salary"), free_is_zero=False))

    # Fees
    fee_txt = first(pairs, "annual_fee")
    waiver_txt = first(pairs, "annual_fee_benefits")
    fee_ctx = " ".join(x for x in [waiver_txt, _sentences(body, r"annual fee")] if x)
    ff = N.fee_flags(fee_txt, fee_ctx)
    if fee_txt or waiver_txt:
        d.set("annual_fee_aed", ff["annual_fee_aed"])
        d.set("is_free_for_life", ff["is_free_for_life"])
        d.set("first_year_free", ff["first_year_free"])
        d.set("annual_fee_waiver_condition", waiver_txt or ff["waiver_condition"])

    # Interest (monthly)
    d.set("monthly_interest_rate_percent", N.parse_monthly_rate(first(pairs, "interest")))

    # FX = foreign currency fee + scheme fee (if quoted separately)
    fx = N.parse_percent(first(pairs, "fx_fee"))
    scheme = N.parse_percent(first(pairs, "scheme_fee"))
    if fx is not None:
        if scheme is not None:
            d.set("fx_fee_percent", round(fx + scheme, 2), inferred=f"fx {fx}% + scheme {scheme}%")
        else:
            d.set("fx_fee_percent", fx, inferred="quoted fee assumed all-in (no separate scheme fee on page)")

    # Welcome bonus
    d.set("welcome_bonus", N.clean(first(pairs, "welcome")))

    # Lifestyle
    lounge = first(pairs, "lounge")
    if lounge is not None:
        d.set("lounge_access", lounge if N.perk_present(lounge) else "None")
    cinema = first(pairs, "cinema")
    if cinema is not None and N.perk_present(cinema):
        d.set("cinema_offers", cinema)
    golf = first(pairs, "golf")
    if golf is not None:
        d.set("golf_access", N.perk_present(golf))
    valet = first(pairs, "valet")
    if valet is not None:
        d.set("valet_parking", N.perk_present(valet))
        if N.perk_present(valet):
            d.set("valet_locations", N.extract_locations(
                " ".join([valet, _sentences(body, r"valet")])))

    d.set("early_cancellation_fee_aed", N.parse_aed(first(pairs, "early_cancellation"), free_is_zero=True))
    d.set("monthly_cap_aed", N.parse_aed(first(pairs, "cashback_cap"), free_is_zero=False)
          or N.parse_monthly_cap(body))

    net = first(pairs, "card_type")
    if net:
        n, _ = N.detect_network(net)
        d.set("network", n.value if n else None)
    return d


def _sentences(body: str, pattern: str, limit: int = 6) -> str:
    """Sentences/lines in body that mention `pattern`."""
    out = []
    for chunk in re.split(r"(?<=[.!?])\s+|\n", body):
        if re.search(pattern, chunk, re.I):
            out.append(chunk.strip())
            if len(out) >= limit:
                break
    return "\n".join(out)


def rate_rows(lines: Iterable[str]) -> list[tuple[str, str]]:
    """Pair each rate line ('5% cashback', '3 miles per AED') with the label line above it.
    Also handles 'Label 5%' on one line.

    Tiered tables ("Dining / 0% / 6%") put several rate lines under one label; all of them
    are paired with it. When a group quotes miles/points/credits, its % lines are only the
    equivalent value of those units, so they are tagged with the unit and not read as cashback."""
    rows: list[tuple[str, str]] = []
    prev: Optional[str] = None
    group: list[str] = []

    def flush():
        if prev and group:
            unit = next((m.group(0) for g in group
                         if (m := re.search(r"miles?|points?|credits?|smiles", g, re.I))), None)
            for g in group:
                rows.append((prev, f"{g} ({unit})" if unit and unit not in g else g))
        group.clear()

    for line in lines:
        if N.looks_like_rate(line) or re.fullmatch(r"\d+(?:\.\d+)?\s*credits?\s+per\s+aed", line, re.I):
            label_inline = re.sub(r"(\d+(?:\.\d+)?\s*%.*|\d+(?:\.\d+)?\s*(miles?|points?).*)$", "", line).strip(" :-–")
            if len(label_inline) >= 3 and not group:
                flush()
                rows.append((label_inline, line))
                prev = None
            else:
                group.append(line)
        elif re.match(r"cap(ped)?\b", line, re.I) and prev:
            continue  # "Capped at AED 150 a month" sits between a label and its rates
        else:
            flush()
            prev = line
    flush()
    return rows


def benefits_from_lines(lines: Iterable[str], limit: int = 5) -> list[str]:
    out = []
    for line in lines:
        if 8 <= len(line) <= 140 and not re.fullmatch(r"(see all|learn more|apply|compare).*", line, re.I):
            out.append(line)
        if len(out) >= limit:
            break
    return out
