"""Pure parsing/normalization helpers. No I/O; everything here is unit-tested."""

from __future__ import annotations

import re
from typing import Iterable, Optional

from slugify import slugify as _slugify

from .schema import (
    ISLAMIC_BANKS,
    BankName,
    HiddenSpendCriterion,
    Network,
    RewardType,
    SpendAppliesTo,
    SpendPeriod,
    Tier,
)

# ---------------------------------------------------------------------------
# Basic text -> number
# ---------------------------------------------------------------------------

_NUM = r"(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)"
_AED_RE = re.compile(
    rf"(?:AED|Dhs?\.?|د\.إ)\s*{_NUM}\s*(k|K)?|{_NUM}\s*(k|K)?\s*(?:AED|Dhs?\b)", re.I
)
_PCT_RE = re.compile(r"(\d+(?:\.\d+)?)\s*%")
_FREE_RE = re.compile(r"\b(free|nil|none|waived|no annual fee|zero|0\s*AED|AED\s*0)\b", re.I)


def slugify(text: str) -> str:
    return _slugify(text, lowercase=True, separator="-", regex_pattern=r"[^a-z0-9]+")


def _to_number(raw: str, k: Optional[str]) -> float:
    n = float(raw.replace(",", ""))
    return n * 1000 if k else n


def parse_aed(text: Optional[str], *, free_is_zero: bool = True) -> Optional[int]:
    """'AED 12,000+' -> 12000, 'AED 5K' -> 5000, 'Free' -> 0, '15,000' -> 15000."""
    if not text:
        return None
    m = _AED_RE.search(text)
    if m:
        if m.group(1):
            return int(round(_to_number(m.group(1), m.group(2))))
        return int(round(_to_number(m.group(3), m.group(4))))
    if free_is_zero and _FREE_RE.search(text):
        return 0
    bare = re.fullmatch(rf"\s*{_NUM}\s*(k|K)?\+?\s*", text)
    if bare:
        return int(round(_to_number(bare.group(1), bare.group(2))))
    return None


def parse_percent(text: Optional[str]) -> Optional[float]:
    if not text:
        return None
    m = _PCT_RE.search(text)
    return float(m.group(1)) if m else None


def parse_monthly_rate(text: Optional[str]) -> Optional[float]:
    """Monthly purchase/profit rate. Converts an APR to monthly if only an APR is given."""
    if not text:
        return None
    t = text.lower()
    pcts = [float(x) for x in _PCT_RE.findall(text)]
    if not pcts:
        return None
    if re.search(r"per month|monthly|p\.m\.|/\s*month", t):
        return pcts[0]
    if re.search(r"per annum|annual|p\.a\.|apr|/\s*year", t) and pcts[0] > 10:
        return round(pcts[0] / 12, 2)
    # Bare value: UAE sites quote monthly; anything > 10 is an APR.
    return pcts[0] if pcts[0] <= 10 else round(pcts[0] / 12, 2)


def clean(text: Optional[str]) -> Optional[str]:
    if text is None:
        return None
    t = " ".join(text.split()).strip(" -–—:·|")
    return t or None


# ---------------------------------------------------------------------------
# Bank / network / tier / islamic
# ---------------------------------------------------------------------------

# Order matters: more specific aliases first ("emirates islamic" before "emirates nbd").
BANK_ALIASES: list[tuple[str, BankName]] = [
    (r"emirates[\s-]*islamic|\bei\b", BankName.EI),
    (r"emirates[\s-]*nbd|\benbd\b|\bliv\b|liv\.", BankName.ENBD),
    (r"abu[\s-]*dhabi[\s-]*islamic|\badib\b", BankName.ADIB),
    (r"abu[\s-]*dhabi[\s-]*commercial|\badcb\b", BankName.ADCB),
    (r"first[\s-]*abu[\s-]*dhabi|\bfab\b", BankName.FAB),
    (r"dubai[\s-]*islamic|\bdib\b", BankName.DIB),
    (r"commercial[\s-]*bank[\s-]*of[\s-]*dubai|\bcbd\b", BankName.CBD),
    (r"\brak[\s-]*bank\b|rakbank|rakislamic|national[\s-]*bank[\s-]*of[\s-]*ras", BankName.RAKBANK),
    (r"\bmashreq\b", BankName.MASHREQ),
    (r"\bhsbc\b", BankName.HSBC),
    (r"\bciti(bank)?\b", BankName.CITI),
]

# Issuers that exist on the aggregators but are outside the target enum.
OUT_OF_SCOPE_ISSUERS = re.compile(
    r"\b(cbi|commercial bank international|al[\s-]*ansari|mal\b|deem|dubai first|ajman bank|"
    r"nbf|national bank of fujairah|uab|emirates investment|al[\s-]*masraf|sib|sharjah islamic|"
    r"american express middle east|wio|ruya|zand)\b",
    re.I,
)

NOT_A_CREDIT_CARD = re.compile(r"\b(prepaid|debit card|travel card|gift card)\b", re.I)


def detect_bank(*texts: Optional[str]) -> Optional[BankName]:
    """Detect bank from slug / bank label / card name. First text with a hit wins."""
    for text in texts:
        if not text:
            continue
        t = text.lower().replace("_", " ")
        # slugs: "emirates-islamic-skywards..." -> treat hyphens as spaces
        t_sp = t.replace("-", " ")
        for pattern, bank in BANK_ALIASES:
            if re.search(pattern, t_sp):
                return bank
    return None


def is_out_of_scope(*texts: Optional[str]) -> bool:
    joined = " ".join(t for t in texts if t).replace("-", " ")
    if NOT_A_CREDIT_CARD.search(joined):
        return True
    return detect_bank(*texts) is None and bool(OUT_OF_SCOPE_ISSUERS.search(joined))


# Tier patterns, most specific first.
_TIER_PATTERNS: list[tuple[str, Tier]] = [
    (r"world[\s-]*elite", Tier.WORLD_ELITE),
    (r"\binfinite\b", Tier.INFINITE),
    (r"\bsignature\b", Tier.SIGNATURE),
    (r"\bworld\b(?![\s-]*(of|cup|class|wide|tour))", Tier.WORLD),
    (r"\bplatinum\b", Tier.PLATINUM),
    (r"\btitanium\b", Tier.TITANIUM),
    (r"\bclassic\b|\bgold\b", Tier.CLASSIC),  # Gold is the entry tier at most UAE banks
]


def detect_tier(*texts: Optional[str]) -> Optional[Tier]:
    for text in texts:
        if not text:
            continue
        t = text.lower().replace("-", " ")
        for pattern, tier in _TIER_PATTERNS:
            if re.search(pattern, t):
                return tier
    return None


_NETWORK_PATTERNS: list[tuple[str, Network]] = [
    (r"american[\s-]*express|\bamex\b", Network.AMEX),
    (r"\bdiners\b", Network.DINERS),
    (r"master[\s-]*card", Network.MASTERCARD),
    (r"\bvisa\b(?![\s-]*(service|services|application|applications|on arrival|processing))",
     Network.VISA),
]

_STRONG_NETWORK_PHRASES: list[tuple[str, Network]] = [
    (r"visa\s+(infinite|signature|platinum|classic|gold)", Network.VISA),
    (r"(world\s+elite|world|titanium|platinum)\s+master[\s-]*card", Network.MASTERCARD),
    (r"master[\s-]*card\s+(world|titanium|platinum)", Network.MASTERCARD),
    (r"american\s+express|\bamex\b", Network.AMEX),
    (r"diners\s+club", Network.DINERS),
]

# Card tiers that only exist on one scheme.
TIER_IMPLIES_NETWORK = {
    Tier.INFINITE: Network.VISA,
    Tier.SIGNATURE: Network.VISA,
    Tier.WORLD: Network.MASTERCARD,
    Tier.WORLD_ELITE: Network.MASTERCARD,
    Tier.TITANIUM: Network.MASTERCARD,
}


def detect_network(
    card_name: Optional[str], body_text: Optional[str] = None, tier: Optional[Tier] = None
) -> tuple[Optional[Network], Optional[str]]:
    """Returns (network, how). `how` is None when stated in the card name; otherwise a
    short note so the QA report can mark the value as inferred."""
    if card_name:
        for pattern, net in _NETWORK_PATTERNS:
            if re.search(pattern, card_name.lower()):
                return net, None
    if body_text:
        t = body_text.lower()
        for pattern, net in _STRONG_NETWORK_PHRASES:
            if re.search(pattern, t):
                return net, f"phrase in page text: /{pattern}/"
    if tier is not None and Tier(tier) in TIER_IMPLIES_NETWORK:
        return TIER_IMPLIES_NETWORK[Tier(tier)], f"implied by tier {Tier(tier).value}"
    return None, None


_ISLAMIC_RE = re.compile(
    r"\bislami(c)?\b|rakislamic|al[\s-]*islami|\bcovered card\b|murabaha|tawarruq|"
    r"shari'?a|\bprofit rate\b|\bujrah\b|\bqard\b",
    re.I,
)


def detect_islamic(bank: Optional[BankName], *texts: Optional[str]) -> bool:
    if bank is not None and BankName(bank) in ISLAMIC_BANKS:
        return True
    return any(t and _ISLAMIC_RE.search(t) for t in texts)


# ---------------------------------------------------------------------------
# Rewards
# ---------------------------------------------------------------------------

RETAIL_COBRANDS = (
    "noon", "lulu", "emaar", "u by emaar", "amazon", "carrefour", "share", "maf", "majid al futtaim",
    "sharaf", "centrepoint", "landmark", "namshi", "talabat", "careem", "adnoc", "enoc", "dragon mart",
    "darna", "aldar", "6th street", "apparel", "dubai duty free", "souq", "lifestyle", "marriott",
    "fc barcelona", "manchester", "real madrid", "al-futtaim", "blue rewards", "tamayaz",
)
AIRLINE_COBRANDS = ("skywards", "etihad", "etihad guest", "air arabia", "flydubai", "voyager",
                    "miles", "airmiles", "air miles", "traveller", "travel")


def detect_reward_types(card_name: str, rewards_text: Optional[str]) -> list[RewardType]:
    name = card_name.lower()
    t = f"{name} {(rewards_text or '').lower()}"
    out: list[RewardType] = []
    if re.search(r"cash\s*back|cashback|\bcash\b(?! advance)", t):
        out.append(RewardType.CASHBACK)
    if re.search(r"\bmiles?\b|skywards|etihad guest|voyager|airmiles|avios", t):
        out.append(RewardType.AIRMILES)
    if re.search(r"\bpoints?\b|touchpoints|\bplus\s?points\b|smiles|bonvoy|rewards? points|"
                 r"\bdarna\b|share points|\bupoints\b", t):
        out.append(RewardType.POINTS)
    if any(re.search(rf"\b{re.escape(c)}\b", name) for c in RETAIL_COBRANDS):
        out.append(RewardType.RETAIL_COBRAND)
    return list(dict.fromkeys(out))


CASHBACK_CATEGORY_KEYWORDS: list[tuple[str, str]] = [
    ("groceries_percent", r"grocer|supermarket|hypermarket|carrefour|lulu|spinneys|waitrose"),
    ("fuel_percent", r"fuel|petrol|adnoc|enoc|eppco|gas station"),
    ("dining_percent", r"dining|restaurant|food|cafe|caf[eé]|talabat|deliveroo|fast food"),
    ("utilities_telecom_percent", r"utilit|telecom|dewa|addc|sewa|etisalat|\be&\b|\bdu\b|bill"),
    ("education_percent", r"educat|school|universit|tuition"),
    ("international", r"international|foreign|abroad|overseas|non[\s-]*aed"),
    ("other", r"all other|everything else|other (spend|purchases|categor)|other retail|base rate"),
]

_RATE_LINE_RE = re.compile(
    r"(\d+(?:\.\d+)?)\s*%|(\d+(?:\.\d+)?)\s*(miles?|points?|smiles|touchpoints)\s*(per|/|for every)\s*(aed|dhs?|1\s*aed|usd|\$)",
    re.I,
)


def looks_like_rate(text: str) -> bool:
    return bool(_RATE_LINE_RE.search(text))


def map_cashback_category(label: str) -> Optional[str]:
    lab = label.lower()
    for key, pat in CASHBACK_CATEGORY_KEYWORDS:
        if re.search(pat, lab):
            return key
    return None


def parse_cashback_rows(rows: Iterable[tuple[str, str]]) -> dict[str, float]:
    """rows: (category label, rate text). Keeps the *highest* % per category.

    Rows that mention miles/points are ignored (not cashback)."""
    out: dict[str, float] = {}
    for label, rate in rows:
        if re.search(r"miles?|points?|credits?|smiles", rate, re.I):
            continue
        # FX / transaction fee rows are charges, not earn rates.
        if re.search(r"\bfees?\b|charges?|transaction fee|mark[\s-]*up", f"{label} {rate}", re.I):
            continue
        pct = parse_percent(rate)
        # 0% comes from "earns 0%" exclusion text or a below-threshold tier, not an earn rate.
        if not pct:
            continue
        # A row can cover several categories: "Grocery, Fuel & Dining".
        hit = False
        for key, pat in CASHBACK_CATEGORY_KEYWORDS:
            if re.search(pat, label.lower()):
                out[key] = max(out.get(key, 0.0), pct)
                hit = True
                if key == "other":
                    break
        if not hit and re.search(r"\b(spend|purchases?)\b", label, re.I):
            out.setdefault("other", pct)
    return out


_CAP_RE = re.compile(
    rf"(?:cap(?:ped)?|max(?:imum)?|up to|limit(?:ed)?)[^.\n]{{0,40}}?AED\s*{_NUM}[^.\n]{{0,40}}?"
    r"(?:per|a|each|every|/)\s*(?:calendar\s+)?(month|statement|billing cycle)",
    re.I,
)


_CAP_CONTEXT_RE = re.compile(r"cash\s*back|cashback|rewards?|earn", re.I)
_CAP_EXCLUDE_RE = re.compile(r"insur|cover|takaful|credit limit|miles|protection|warranty", re.I)


def parse_monthly_cap(text: Optional[str], *, require_context: bool = True) -> Optional[int]:
    """Monthly cashback/reward cap. With require_context, the sentence must be about
    cashback or rewards (free text elsewhere on a page mentions insurance cover etc.)."""
    if not text:
        return None
    for m in _CAP_RE.finditer(text):
        start = max(text.rfind(".", 0, m.start()), text.rfind("\n", 0, m.start())) + 1
        end = min(x for x in (text.find(".", m.end()), text.find("\n", m.end()), len(text)) if x >= 0)
        sentence = text[start:end]
        if _CAP_EXCLUDE_RE.search(sentence):
            continue
        if require_context and not _CAP_CONTEXT_RE.search(sentence):
            continue
        return int(round(_to_number(m.group(1), None)))
    return None


# ---------------------------------------------------------------------------
# Fees
# ---------------------------------------------------------------------------

_FFL_RE = re.compile(r"free\s+for\s+life|lifetime\s+free|life[\s-]*time\s+free|no\s+annual\s+fee\s+ever|"
                     r"free\s+forever|always\s+free", re.I)
_FIRST_YEAR_RE = re.compile(r"first\s+year(\s+only)?\s+(free|waived)|free\s+(for\s+)?(the\s+)?first\s+year|"
                            r"(waived|free)\s+in\s+(the\s+)?first\s+year|1st\s+year\s+free", re.I)
_WAIVER_RE = re.compile(
    r"[^.\n]*(waive[sd]?|waiver|reversed|refund(ed)?|free\s+(for\s+)?(the\s+)?first)[^.\n]*", re.I
)


def fee_flags(fee_text: Optional[str], context: Optional[str]) -> dict:
    """Returns {annual_fee_aed, is_free_for_life, first_year_free, waiver_condition}."""
    blob = "\n".join(t for t in (fee_text, context) if t)
    fee = parse_aed(fee_text) if fee_text else None
    first_year = bool(_FIRST_YEAR_RE.search(blob))
    ffl = bool(_FFL_RE.search(blob))
    if not ffl and fee == 0 and fee_text and not first_year:
        # "Annual Fee: Free" / "No Annual Fee" with no time-bound wording.
        if re.search(r"\b(free|no annual fee|nil|0)\b", fee_text, re.I):
            ffl = True
    waiver = None
    if not ffl:
        hits = [clean(m.group(0)) for m in _WAIVER_RE.finditer(blob)
                if re.search(r"annual|fee|first year|spend", m.group(0), re.I)]
        hits = [h for h in dict.fromkeys(hits) if h]
        if hits:
            waiver = "; ".join(hits[:2])
    if ffl:
        fee = 0
    return {
        "annual_fee_aed": fee,
        "is_free_for_life": ffl,
        "first_year_free": True if (first_year or ffl) else None,  # None = page silent
        "waiver_condition": waiver,
    }


# ---------------------------------------------------------------------------
# Lifestyle
# ---------------------------------------------------------------------------

VALET_LOCATIONS = [
    "Dubai", "Abu Dhabi", "Sharjah", "Ajman", "Ras Al Khaimah", "Fujairah", "Umm Al Quwain", "Al Ain",
    "Dubai Mall", "Mall of the Emirates", "Yas Mall", "Dubai Marina Mall", "Mirdif City Centre",
    "Deira City Centre", "Ibn Battuta", "Galleria", "Abu Dhabi Mall", "Marina Mall", "Al Wahda Mall",
    "Dubai Festival City", "City Centre", "Sahara Centre", "WTC Abu Dhabi", "DIFC",
]

_NEGATIVE_RE = re.compile(r"\b(no|not|none|n/a|unavailable|not available|—|-)\b", re.I)


def perk_present(value: Optional[str]) -> Optional[bool]:
    if value is None:
        return None
    v = value.strip()
    if not v:
        return None
    if re.fullmatch(r"(no|none|n/?a|not available|not included|-|—|✗|✘|x)", v, re.I):
        return False
    return True


def extract_locations(text: Optional[str]) -> list[str]:
    if not text:
        return []
    found = []
    for loc in sorted(VALET_LOCATIONS, key=len, reverse=True):
        if re.search(rf"\b{re.escape(loc)}\b", text, re.I) and not any(loc in f for f in found):
            found.append(loc)
    return found


# ---------------------------------------------------------------------------
# Hidden spend criteria
# ---------------------------------------------------------------------------

_SPEND_RE = re.compile(
    r"[^.\n;?!]*?(?:spend(?:s|ing)?|minimum\s+(?:monthly\s+)?(?:card\s+)?spend|retail\s+spend|"
    r"purchases?\s+of|transact(?:ions?)?\s+(?:of|worth))[^.\n;]*?"
    rf"(?:AED|Dhs?\.?)\s*{_NUM}\s*(k|K)?[^.\n;?!]*",
    re.I,
)

_APPLIES_KEYWORDS: list[tuple[SpendAppliesTo, str]] = [
    (SpendAppliesTo.ANNUAL_FEE_WAIVER, r"annual fee|fee waiver|waive"),
    (SpendAppliesTo.WELCOME_BONUS, r"welcome|bonus|sign[\s-]*up|joining|within\s+\d+\s+(days|months)|of (card )?issuance"),
    (SpendAppliesTo.LOUNGE_ACCESS, r"lounge"),
    (SpendAppliesTo.CINEMA, r"cinema|movie|vox|reel"),
    (SpendAppliesTo.GOLF, r"golf"),
    (SpendAppliesTo.VALET, r"valet"),
    (SpendAppliesTo.CASHBACK_RATE, r"cash\s*back|cashback"),
    (SpendAppliesTo.REWARD_RATE, r"miles|points|earn|reward|\brates?\b|\d\s*%"),
]


def _period(text: str) -> tuple[SpendPeriod, Optional[int]]:
    t = text.lower()
    m = re.search(r"within\s+(\d+)\s+(day|days|month|months)", t)
    if m:
        n = int(m.group(1))
        return SpendPeriod.FIRST_N_DAYS, n * (30 if m.group(2).startswith("month") else 1)
    if re.search(r"statement|billing cycle", t):
        return SpendPeriod.STATEMENT_CYCLE, None
    if re.search(r"per month|a month|monthly|each month|every month|/\s*month", t):
        return SpendPeriod.MONTHLY, None
    if re.search(r"quarter", t):
        return SpendPeriod.QUARTERLY, None
    if re.search(r"per year|a year|annual|yearly|per annum|anniversary", t):
        return SpendPeriod.ANNUAL, None
    return SpendPeriod.UNKNOWN, None


def _prominent(amount: int, prominent_text: str) -> bool:
    """Condition is prominent if a headline/summary line states the same amount *as a
    spend condition* (not e.g. a salary that happens to be the same number)."""
    for line in prominent_text.splitlines():
        if (f"{amount:,}" in line or str(amount) in line) and re.search(r"spend|purchase", line, re.I):
            return True
    return False


def find_spend_criteria(
    text: Optional[str], *, source_url: Optional[str] = None, prominent_text: str = ""
) -> list[HiddenSpendCriterion]:
    """Rule-based detector for spend thresholds that gate a benefit.

    `prominent_text` is the headline/summary area of the page; a condition that also
    appears there counts as prominently disclosed."""
    if not text:
        return []
    out: list[HiddenSpendCriterion] = []
    seen: set[tuple] = set()
    for m in _SPEND_RE.finditer(text):
        sentence = clean(m.group(0)) or ""
        amount = int(round(_to_number(m.group(1), m.group(2))))
        applies = SpendAppliesTo.OTHER
        for kind, pat in _APPLIES_KEYWORDS:
            if re.search(pat, sentence, re.I):
                applies = kind
                break
        period, window = _period(sentence)
        key = (applies, amount, period)
        if key in seen:
            continue
        seen.add(key)
        out.append(
            HiddenSpendCriterion(
                applies_to=applies,
                min_spend_aed=amount,
                period=period,
                window_days=window,
                condition_text=sentence[:300],
                prominently_disclosed=_prominent(amount, prominent_text),
                source_url=source_url,
            )
        )
    return out


_ONE_OFF_RE = re.compile(
    r"welcome|bonus|joining|annual fee|waive|first\s+(\d+|two|three|four|six)\s+(billing\s+)?"
    r"(statements?|months?|days|cycles?)|of (card )?issuance|from (card )?activation", re.I)


def min_monthly_spend(criteria: list[HiddenSpendCriterion]) -> Optional[int]:
    """Spend needed per month/statement to unlock headline earn rates (not welcome/fee)."""
    excluded = {
        c.min_spend_aed for c in criteria
        if SpendAppliesTo(c.applies_to) in (SpendAppliesTo.WELCOME_BONUS, SpendAppliesTo.ANNUAL_FEE_WAIVER)
    }
    vals = [
        c.min_spend_aed
        for c in criteria
        if c.min_spend_aed
        and c.min_spend_aed not in excluded
        and not _ONE_OFF_RE.search(c.condition_text or "")
        and SpendAppliesTo(c.applies_to) in (SpendAppliesTo.CASHBACK_RATE, SpendAppliesTo.REWARD_RATE)
        and SpendPeriod(c.period) in (SpendPeriod.MONTHLY, SpendPeriod.STATEMENT_CYCLE)
    ]
    return min(vals) if vals else None


# ---------------------------------------------------------------------------
# Ecosystem tags (site extras)
# ---------------------------------------------------------------------------

_ECOSYSTEM_PATTERNS = {
    "skywards": r"skywards",
    "etihad_guest": r"etihad",
    "maf_share": r"\bshare\b|majid al futtaim|\bmaf\b",
    "aldar_darna": r"darna|aldar",
    "noon": r"\bnoon\b",
    "talabat": r"talabat",
    "careem": r"careem",
    "adnoc": r"adnoc",
    "cinema_bogo": r"buy[\s-]*one[\s-]*get[\s-]*one|\bbogo\b|1\s*\+\s*1",
}


def ecosystem_tags(card_name: str, text: str, perks: dict) -> list[str]:
    blob = f"{card_name} {text}".lower()
    tags = [t for t, p in _ECOSYSTEM_PATTERNS.items() if re.search(p, blob)]
    if tags.count("cinema_bogo") and not re.search(r"cinema|movie|vox|reel", blob):
        tags.remove("cinema_bogo")
    if perks.get("lounge_access") and perk_present(perks["lounge_access"]):
        tags.append("airport_lounge")
    if perks.get("valet_parking"):
        tags.append("valet")
    if perks.get("golf_access"):
        tags.append("golf")
    return list(dict.fromkeys(tags))
