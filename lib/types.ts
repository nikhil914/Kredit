/**
 * Card data contract.
 *
 * `ScraperCard` mirrors the Pydantic schema produced by the UAE credit card
 * scraping pipeline field-for-field, so scraped JSON can replace
 * `data/cards.json` without a mapping layer.
 *
 * `CardExtensions` are OPTIONAL fields the UI can use when present. Every
 * consumer falls back gracefully when they are missing (see lib/cards.ts).
 */

export type BankCode =
  | "ENBD"
  | "FAB"
  | "ADCB"
  | "ADIB"
  | "Mashreq"
  | "HSBC"
  | "Citi"
  | "RAKBANK"
  | "DIB"
  | "EI"
  | "CBD";

export type Network = "Visa" | "Mastercard" | "Amex" | "Diners";

export type Tier =
  | "Classic"
  | "Titanium"
  | "Platinum"
  | "Signature"
  | "World"
  | "Infinite"
  | "World Elite";

export type RewardType = "Cashback" | "AirMiles" | "Points" | "Retail_Cobrand";

export interface LifestylePerks {
  lounge_access: string | null;
  cinema_offers: string | null;
  golf_access: boolean;
  valet_parking: boolean;
  valet_locations: string[];
}

export interface CashbackRates {
  groceries_percent: number;
  fuel_percent: number;
  dining_percent: number;
  utilities_telecom_percent: number;
  education_percent: number;
  /** 0 or null = uncapped */
  monthly_cap_aed: number | null;
  /** Extension: rate on foreign-currency spend */
  international_percent?: number;
  /** Extension: base rate on all other spend */
  other_percent?: number;
}

/** Exact scraper schema. */
export interface ScraperCard {
  id: string;
  card_name: string;
  bank_name: BankCode;
  is_islamic: boolean;
  network: Network;
  tier: Tier;
  min_salary_aed: number;
  annual_fee_aed: number;
  is_free_for_life: boolean;
  annual_fee_waiver_condition: string | null;
  monthly_interest_rate_percent: number;
  fx_fee_percent: number;
  welcome_bonus: string | null;
  reward_type: RewardType[];
  key_benefits: string[];
  lifestyle_perks: LifestylePerks;
  /** For miles/points cards these are the effective AED value-back %. */
  cashback_rates: CashbackRates;
  source_urls: string[];
}

export type EcosystemTag =
  | "skywards"
  | "etihad_guest"
  | "maf_share"
  | "aldar_darna"
  | "noon"
  | "talabat"
  | "careem"
  | "adnoc"
  | "cinema_bogo"
  | "airport_lounge"
  | "valet"
  | "golf";

/** Optional UI enrichments, not (yet) in the scraper schema. */
export interface CardExtensions {
  first_year_free?: boolean;
  /** Monthly spend needed to unlock the headline reward rates. */
  min_monthly_spend_aed?: number | null;
  early_cancellation_fee_aed?: number | null;
  apply_url?: string;
  ecosystem_tags?: EcosystemTag[];
  /** Two-stop gradient + ink colour for the card artwork. */
  art?: { from: string; to: string; ink?: "light" | "dark" };
  /** ISO date the record was last verified. */
  last_verified?: string;
}

export type Card = ScraperCard & CardExtensions;

export type FeeFilter = "free_for_life" | "first_year_free" | "premium";
export type CardTypeFilter = "all" | "islamic" | "conventional";
export type SortKey = "recommended" | "net_value" | "fee_asc" | "salary_asc";

export interface MonthlySpend {
  groceries: number;
  fuel: number;
  dining: number;
  utilities: number;
  education: number;
  international: number;
  other: number;
}
