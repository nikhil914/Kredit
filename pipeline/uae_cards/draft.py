"""Source-agnostic intermediate record + builder into the strict schema.

Every source parser produces a `CardDraft` where `None` means "this page did not say".
`merge.py` combines drafts; `build()` turns the merged draft into
(CreditCard, SiteExtras, CardReport).
"""

from __future__ import annotations

from dataclasses import dataclass, field, fields
from typing import Optional

from . import normalize as N
from .schema import (
    CardReport,
    CashbackRates,
    CreditCard,
    HiddenSpendCriterion,
    LifestylePerks,
    SiteExtras,
)


@dataclass
class CardDraft:
    source: str
    url: str
    card_name: Optional[str] = None
    bank_label: Optional[str] = None
    slug_hint: Optional[str] = None

    network: Optional[str] = None
    tier: Optional[str] = None
    is_islamic: Optional[bool] = None
    min_salary_aed: Optional[int] = None
    annual_fee_aed: Optional[int] = None
    is_free_for_life: Optional[bool] = None
    first_year_free: Optional[bool] = None
    annual_fee_waiver_condition: Optional[str] = None
    monthly_interest_rate_percent: Optional[float] = None
    fx_fee_percent: Optional[float] = None
    welcome_bonus: Optional[str] = None
    reward_type: Optional[list[str]] = None
    key_benefits: Optional[list[str]] = None

    lounge_access: Optional[str] = None
    cinema_offers: Optional[str] = None
    golf_access: Optional[bool] = None
    valet_parking: Optional[bool] = None
    valet_locations: Optional[list[str]] = None

    cashback: Optional[dict[str, float]] = None  # keys: *_percent, international, other
    monthly_cap_aed: Optional[int] = None

    early_cancellation_fee_aed: Optional[int] = None
    apply_url: Optional[str] = None

    full_text: str = ""
    prominent_text: str = ""
    hidden_spend: list[HiddenSpendCriterion] = field(default_factory=list)
    inferred: dict[str, str] = field(default_factory=dict)
    field_sources: dict[str, str] = field(default_factory=dict)
    extra_urls: list[str] = field(default_factory=list)

    # Fields that merge.py may fill from secondary sources.
    MERGEABLE = (
        "network", "tier", "min_salary_aed", "annual_fee_aed", "is_free_for_life", "first_year_free",
        "annual_fee_waiver_condition", "monthly_interest_rate_percent", "fx_fee_percent",
        "welcome_bonus", "reward_type", "key_benefits", "lounge_access", "cinema_offers",
        "golf_access", "valet_parking", "valet_locations", "monthly_cap_aed",
        "early_cancellation_fee_aed", "apply_url",
    )

    def set(self, name: str, value, *, inferred: Optional[str] = None) -> None:
        if value is None or value == [] or value == {}:
            return
        setattr(self, name, value)
        self.field_sources[name] = self.source
        if inferred:
            self.inferred[name] = inferred

    def known(self) -> dict:
        return {f.name: getattr(self, f.name) for f in fields(self)
                if f.name in self.MERGEABLE and getattr(self, f.name) not in (None, [], {})}


class OutOfScope(Exception):
    """Card is not a credit card or its issuer is outside the BankName enum."""


def card_id(bank_slug_hint: Optional[str], card_name: str, bank) -> str:
    """Prefer the source slug (stable across runs); fall back to bank + name."""
    if bank_slug_hint:
        return N.slugify(bank_slug_hint)
    base = N.slugify(card_name)
    bank_slug = N.slugify(str(bank.value if hasattr(bank, "value") else bank))
    return base if base.startswith(bank_slug) else f"{bank_slug}-{base}"


def build(d: CardDraft) -> tuple[CreditCard, SiteExtras, CardReport]:
    if not d.card_name:
        raise ValueError(f"no card name for {d.url}")
    if N.is_out_of_scope(d.slug_hint, d.bank_label, d.card_name):
        raise OutOfScope(d.card_name)
    bank = N.detect_bank(d.bank_label, d.slug_hint, d.card_name)
    if bank is None:
        raise OutOfScope(f"issuer not in enum: {d.bank_label or d.card_name}")

    inferred = dict(d.inferred)

    tier = d.tier or N.detect_tier(d.card_name, d.slug_hint)
    if tier and not d.tier:
        inferred["tier"] = "from card name"
    network = d.network
    if not network:
        network, how = N.detect_network(d.card_name, d.full_text, tier)
        if network and how:
            inferred["network"] = how

    is_islamic = bool(d.is_islamic) or N.detect_islamic(bank, d.card_name, d.slug_hint, d.bank_label)

    reward_type = d.reward_type or [r.value for r in N.detect_reward_types(d.card_name, d.full_text[:4000])]

    cb = d.cashback or {}
    cashback = CashbackRates(
        groceries_percent=cb.get("groceries_percent"),
        fuel_percent=cb.get("fuel_percent"),
        dining_percent=cb.get("dining_percent"),
        utilities_telecom_percent=cb.get("utilities_telecom_percent"),
        education_percent=cb.get("education_percent"),
        monthly_cap_aed=d.monthly_cap_aed,
    )
    if cb and "Cashback" not in reward_type:
        reward_type = ["Cashback", *reward_type]

    perks = LifestylePerks(
        lounge_access=N.clean(d.lounge_access),
        cinema_offers=N.clean(d.cinema_offers),
        golf_access=bool(d.golf_access),
        valet_parking=bool(d.valet_parking),
        valet_locations=d.valet_locations or [],
    )

    ffl = bool(d.is_free_for_life)
    fee = 0 if ffl else d.annual_fee_aed

    card = CreditCard(
        id=card_id(d.slug_hint, d.card_name, bank),
        card_name=d.card_name,
        bank_name=bank,
        is_islamic=is_islamic,
        network=network,
        tier=tier,
        min_salary_aed=d.min_salary_aed,
        annual_fee_aed=fee,
        is_free_for_life=ffl,
        annual_fee_waiver_condition=None if ffl else N.clean(d.annual_fee_waiver_condition),
        monthly_interest_rate_percent=d.monthly_interest_rate_percent,
        fx_fee_percent=d.fx_fee_percent,
        welcome_bonus=N.clean(d.welcome_bonus),
        reward_type=reward_type,
        key_benefits=d.key_benefits or [],
        lifestyle_perks=perks,
        cashback_rates=cashback,
        source_urls=[d.url, *d.extra_urls],
    )

    criteria = N.find_spend_criteria(d.full_text, source_url=d.url, prominent_text=d.prominent_text)
    seen = {(c.applies_to, c.min_spend_aed) for c in criteria}
    for c in d.hidden_spend:  # from secondary sources or the LLM pass
        if (c.applies_to, c.min_spend_aed) not in seen:
            criteria.append(c)
            seen.add((c.applies_to, c.min_spend_aed))
    extras = SiteExtras(
        cashback_international_percent=cb.get("international"),
        cashback_other_percent=cb.get("other"),
        first_year_free=d.first_year_free if d.first_year_free is not None else (True if ffl else None),
        min_monthly_spend_aed=N.min_monthly_spend(criteria),
        early_cancellation_fee_aed=d.early_cancellation_fee_aed,
        apply_url=d.apply_url,
        ecosystem_tags=N.ecosystem_tags(card.card_name, d.full_text[:6000], perks.model_dump()),
    )
    report = CardReport(
        id=card.id,
        missing_fields=card.missing_fields(),
        inferred_fields=inferred,
        hidden_spend_criteria=criteria,
        field_sources=d.field_sources,
    )
    return card, extras, report
