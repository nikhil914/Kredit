"""Match secondary-source drafts to kredit.ae drafts and fill gaps.

Matching rule: same bank (enum), same tier (or both unknown), and a fuzzy name score
>= threshold on the *distinctive* tokens (bank names, "credit", "card", scheme names
removed). Tier equality stops "Mashreq Aura" matching "Mashreq Aura World Elite".

Merge rule: kredit.ae value wins. A secondary value only fills a field kredit.ae left
empty. When both have a numeric value and they disagree beyond tolerance, the conflict
is recorded for review and kredit.ae's value is kept.
"""

from __future__ import annotations

import re
from typing import Optional

from rapidfuzz import fuzz

from . import normalize as N
from .draft import CardDraft

STOP = {
    "credit", "card", "cards", "bank", "the", "visa", "mastercard", "master", "amex", "by",
    "emirates", "nbd", "enbd", "fab", "first", "abu", "dhabi", "commercial", "adcb", "adib", "islamic",
    "mashreq", "hsbc", "citi", "citibank", "rakbank", "rak", "dib", "dubai", "ei", "cbd", "of", "uae",
}

NUMERIC_TOLERANCE = {
    "min_salary_aed": 0.0,
    "annual_fee_aed": 0.06,          # VAT-inclusive vs exclusive (5%) is common
    "monthly_interest_rate_percent": 0.02,
    "fx_fee_percent": 0.35,          # some sites quote without scheme fee
}


def name_key(name: str) -> str:
    toks = re.findall(r"[a-z0-9]+", name.lower())
    return " ".join(t for t in toks if t not in STOP)


def _tier(d: CardDraft):
    return d.tier or N.detect_tier(d.card_name, d.slug_hint)


def _bank(d: CardDraft):
    return N.detect_bank(d.bank_label, d.slug_hint, d.card_name)


def match_score(a: CardDraft, b: CardDraft) -> float:
    if not a.card_name or not b.card_name:
        return 0.0
    if _bank(a) is None or _bank(a) != _bank(b):
        return 0.0
    if _tier(a) != _tier(b):
        return 0.0
    ka, kb = name_key(a.card_name), name_key(b.card_name)
    if not ka or not kb:
        return 0.0
    return float(fuzz.token_sort_ratio(ka, kb))


def best_match(target: CardDraft, candidates: list[CardDraft], threshold: float = 85.0) -> Optional[CardDraft]:
    scored = [(match_score(target, c), c) for c in candidates]
    scored = [s for s in scored if s[0] >= threshold]
    if not scored:
        return None
    scored.sort(key=lambda s: -s[0])
    # Ambiguous: two candidates tie at the top -> do not guess.
    if len(scored) > 1 and scored[0][0] == scored[1][0] and scored[0][1].card_name != scored[1][1].card_name:
        return None
    return scored[0][1]


def plausible(url_text: str, primaries: list[CardDraft], threshold: float = 70.0) -> bool:
    """Cheap pre-filter on a secondary URL slug before spending a request on it.
    Bank must match; name compared loosely (token_set, no tier gate)."""
    bank = N.detect_bank(url_text)
    if bank is None:
        return False
    key = name_key(url_text)
    for p in primaries:
        if _bank(p) == bank and p.card_name and fuzz.token_set_ratio(key, name_key(p.card_name)) >= threshold:
            return True
    return False


def _differs(field: str, a, b) -> bool:
    if isinstance(a, bool) or isinstance(b, bool):
        return a != b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        tol = NUMERIC_TOLERANCE.get(field)
        if tol is None:
            return a != b
        base = max(abs(a), 1e-9)
        return abs(a - b) / base > tol if tol < 1 else abs(a - b) > tol
    return False


def merge(primary: CardDraft, secondaries: list[CardDraft]) -> tuple[CardDraft, list[dict]]:
    conflicts: list[dict] = []
    for sec in secondaries:
        sec_known = sec.known()
        for fld, val in sec_known.items():
            cur = getattr(primary, fld)
            if cur in (None, [], {}):
                setattr(primary, fld, val)
                primary.field_sources[fld] = sec.source
                if fld in sec.inferred:
                    primary.inferred[fld] = f"{sec.source}: {sec.inferred[fld]}"
            elif _differs(fld, cur, val):
                conflicts.append({"field": fld, "kept": cur, "kept_from": primary.field_sources.get(fld, primary.source),
                                  "other": val, "other_from": sec.source, "other_url": sec.url})
        if sec.cashback and not primary.cashback:
            primary.cashback = dict(sec.cashback)
            primary.field_sources["cashback"] = sec.source
        elif sec.cashback and primary.cashback:
            for k, v in sec.cashback.items():
                primary.cashback.setdefault(k, v)
        if sec.full_text:
            # Secondary T&C wording often states thresholds the primary omits.
            primary.hidden_spend.extend(N.find_spend_criteria(sec.full_text, source_url=sec.url))
        # Always cite a matched source, even if it only confirmed existing values.
        primary.extra_urls.append(sec.url)
    return primary, conflicts
