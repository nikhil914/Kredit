"""Target schema.

`CreditCard` is the strict, unified record: exactly the fields in the spec, no extras
(`extra="forbid"`). Everything else the pipeline learns (hidden spend criteria, provenance,
site-only extras) lives in sidecar models so the core JSON stays exact.

Nullability: a field is `None` when no source states it. The pipeline never invents a
value (e.g. it will not guess an interest rate). `missing_fields()` lists the gaps so QA
can chase them.
"""

from __future__ import annotations

import re
from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class BankName(str, Enum):
    ENBD = "ENBD"
    FAB = "FAB"
    ADCB = "ADCB"
    ADIB = "ADIB"
    MASHREQ = "Mashreq"
    HSBC = "HSBC"
    CITI = "Citi"
    RAKBANK = "RAKBANK"
    DIB = "DIB"
    EI = "EI"
    CBD = "CBD"


ISLAMIC_BANKS = {BankName.ADIB, BankName.DIB, BankName.EI}


class Network(str, Enum):
    VISA = "Visa"
    MASTERCARD = "Mastercard"
    AMEX = "Amex"
    DINERS = "Diners"


class Tier(str, Enum):
    CLASSIC = "Classic"
    TITANIUM = "Titanium"
    PLATINUM = "Platinum"
    SIGNATURE = "Signature"
    WORLD = "World"
    INFINITE = "Infinite"
    WORLD_ELITE = "World Elite"


class RewardType(str, Enum):
    CASHBACK = "Cashback"
    AIRMILES = "AirMiles"
    POINTS = "Points"
    RETAIL_COBRAND = "Retail_Cobrand"


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", use_enum_values=True, validate_assignment=True)


class LifestylePerks(_Strict):
    lounge_access: Optional[str] = None
    cinema_offers: Optional[str] = None
    golf_access: bool = False
    valet_parking: bool = False
    valet_locations: list[str] = Field(default_factory=list)


class CashbackRates(_Strict):
    groceries_percent: Optional[float] = None
    fuel_percent: Optional[float] = None
    dining_percent: Optional[float] = None
    utilities_telecom_percent: Optional[float] = None
    education_percent: Optional[float] = None
    monthly_cap_aed: Optional[int] = None

    @field_validator(
        "groceries_percent", "fuel_percent", "dining_percent",
        "utilities_telecom_percent", "education_percent",
    )
    @classmethod
    def _pct_range(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and not (0 <= v <= 100):
            raise ValueError(f"cashback percent out of range: {v}")
        return v


class CreditCard(_Strict):
    id: str
    card_name: str
    bank_name: BankName
    is_islamic: bool
    network: Optional[Network] = None
    tier: Optional[Tier] = None
    min_salary_aed: Optional[int] = None
    annual_fee_aed: Optional[int] = None
    is_free_for_life: bool = False
    annual_fee_waiver_condition: Optional[str] = None
    monthly_interest_rate_percent: Optional[float] = None
    fx_fee_percent: Optional[float] = None
    welcome_bonus: Optional[str] = None
    reward_type: list[RewardType] = Field(default_factory=list)
    key_benefits: list[str] = Field(default_factory=list)
    lifestyle_perks: LifestylePerks = Field(default_factory=LifestylePerks)
    cashback_rates: CashbackRates = Field(default_factory=CashbackRates)
    source_urls: list[str] = Field(default_factory=list)

    @field_validator("id")
    @classmethod
    def _slug(cls, v: str) -> str:
        if not SLUG_RE.match(v):
            raise ValueError(f"id must be a lowercase slug, got {v!r}")
        return v

    @field_validator("key_benefits")
    @classmethod
    def _max_five(cls, v: list[str]) -> list[str]:
        seen: list[str] = []
        for item in v:
            item = " ".join(item.split())
            if item and item.lower() not in {s.lower() for s in seen}:
                seen.append(item[:140])
        return seen[:5]

    @field_validator("reward_type")
    @classmethod
    def _dedupe_rewards(cls, v: list) -> list:
        return list(dict.fromkeys(v))

    @field_validator("source_urls")
    @classmethod
    def _dedupe_urls(cls, v: list[str]) -> list[str]:
        return list(dict.fromkeys(u for u in v if u))

    @field_validator("min_salary_aed", "annual_fee_aed")
    @classmethod
    def _non_negative(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and v < 0:
            raise ValueError("must be >= 0")
        return v

    @field_validator("monthly_interest_rate_percent", "fx_fee_percent")
    @classmethod
    def _sane_pct(cls, v: Optional[float]) -> Optional[float]:
        # UAE monthly purchase rates sit ~0-4.5%; FX fees ~0-5%. >10 means an APR or parse error.
        if v is not None and not (0 <= v <= 10):
            raise ValueError(f"percent looks wrong (APR instead of monthly?): {v}")
        return v

    @model_validator(mode="after")
    def _consistency(self) -> "CreditCard":
        if self.is_free_for_life and self.annual_fee_aed not in (None, 0):
            raise ValueError("is_free_for_life=True but annual_fee_aed != 0")
        if self.is_free_for_life and self.annual_fee_aed is None:
            self.annual_fee_aed = 0
        if BankName(self.bank_name) in ISLAMIC_BANKS and not self.is_islamic:
            self.is_islamic = True
        return self

    def missing_fields(self) -> list[str]:
        out = [k for k, v in self.model_dump().items() if v is None]
        if not self.reward_type:
            out.append("reward_type")
        if self.lifestyle_perks.lounge_access is None:
            out.append("lifestyle_perks.lounge_access")
        if RewardType.CASHBACK.value in self.reward_type:
            out += [
                f"cashback_rates.{k}" for k, v in self.cashback_rates.model_dump().items() if v is None
            ]
        return out


# ---------------------------------------------------------------------------
# Sidecar models (not part of the core card JSON)
# ---------------------------------------------------------------------------


class SpendAppliesTo(str, Enum):
    WELCOME_BONUS = "welcome_bonus"
    ANNUAL_FEE_WAIVER = "annual_fee_waiver"
    CASHBACK_RATE = "cashback_rate"
    REWARD_RATE = "reward_rate"
    LOUNGE_ACCESS = "lounge_access"
    CINEMA = "cinema"
    GOLF = "golf"
    VALET = "valet"
    OTHER = "other"


class SpendPeriod(str, Enum):
    MONTHLY = "monthly"
    STATEMENT_CYCLE = "statement_cycle"
    QUARTERLY = "quarterly"
    ANNUAL = "annual"
    FIRST_N_DAYS = "first_n_days"
    ONE_TIME = "one_time"
    UNKNOWN = "unknown"


class HiddenSpendCriterion(_Strict):
    applies_to: SpendAppliesTo
    min_spend_aed: Optional[int] = None
    period: SpendPeriod = SpendPeriod.UNKNOWN
    window_days: Optional[int] = None
    condition_text: str
    prominently_disclosed: bool = False
    source_url: Optional[str] = None


class SiteExtras(_Strict):
    """Optional fields the comparison site can use. Emitted to cards_extended.json only."""

    cashback_international_percent: Optional[float] = None
    cashback_other_percent: Optional[float] = None
    first_year_free: Optional[bool] = None
    min_monthly_spend_aed: Optional[int] = None
    early_cancellation_fee_aed: Optional[int] = None
    apply_url: Optional[str] = None
    ecosystem_tags: list[str] = Field(default_factory=list)


ECOSYSTEM_TAGS = (
    "skywards", "etihad_guest", "maf_share", "aldar_darna", "noon", "talabat",
    "careem", "adnoc", "cinema_bogo", "airport_lounge", "valet", "golf",
)


class CardReport(_Strict):
    """Per-card QA record: what is missing, what conflicts, what was inferred."""

    id: str
    missing_fields: list[str] = Field(default_factory=list)
    inferred_fields: dict[str, str] = Field(default_factory=dict)
    conflicts: list[dict] = Field(default_factory=list)
    hidden_spend_criteria: list[HiddenSpendCriterion] = Field(default_factory=list)
    field_sources: dict[str, str] = Field(default_factory=dict)


def extended_record(card: CreditCard, extras: SiteExtras) -> dict:
    """Core card + site extras in the shape the Next.js site reads.

    Extras nest where the site expects them (cashback_rates.international_percent etc.).
    """
    d = card.model_dump(mode="json")
    d["cashback_rates"]["international_percent"] = extras.cashback_international_percent
    d["cashback_rates"]["other_percent"] = extras.cashback_other_percent
    d["first_year_free"] = extras.first_year_free
    d["min_monthly_spend_aed"] = extras.min_monthly_spend_aed
    d["early_cancellation_fee_aed"] = extras.early_cancellation_fee_aed
    d["apply_url"] = extras.apply_url
    d["ecosystem_tags"] = extras.ecosystem_tags
    return d
