import type {
  BankCode,
  Card,
  CardTypeFilter,
  EcosystemTag,
  FeeFilter,
  MonthlySpend,
  SortKey,
} from "./types";

/* ------------------------------------------------------------------ */
/* Bank metadata                                                       */
/* ------------------------------------------------------------------ */

export const BANKS: Record<
  BankCode,
  { name: string; nameAr: string; mono: string; color: string }
> = {
  ENBD: { name: "Emirates NBD", nameAr: "الإمارات دبي الوطني", mono: "EN", color: "#0B3D91" },
  FAB: { name: "First Abu Dhabi Bank", nameAr: "بنك أبوظبي الأول", mono: "FAB", color: "#1C3F94" },
  ADCB: { name: "ADCB", nameAr: "بنك أبوظبي التجاري", mono: "AD", color: "#C8102E" },
  ADIB: { name: "Abu Dhabi Islamic Bank", nameAr: "مصرف أبوظبي الإسلامي", mono: "AI", color: "#00703C" },
  Mashreq: { name: "Mashreq", nameAr: "المشرق", mono: "MQ", color: "#F15A22" },
  HSBC: { name: "HSBC UAE", nameAr: "إتش إس بي سي", mono: "HS", color: "#DB0011" },
  Citi: { name: "Citibank UAE", nameAr: "سيتي بنك", mono: "CI", color: "#056DAE" },
  RAKBANK: { name: "RAKBANK", nameAr: "راك بنك", mono: "RB", color: "#B5121B" },
  DIB: { name: "Dubai Islamic Bank", nameAr: "بنك دبي الإسلامي", mono: "DI", color: "#2E2A25" },
  EI: { name: "Emirates Islamic", nameAr: "الإمارات الإسلامي", mono: "EI", color: "#00843D" },
  CBD: { name: "Commercial Bank of Dubai", nameAr: "بنك دبي التجاري", mono: "CB", color: "#00539B" },
};

/* ------------------------------------------------------------------ */
/* Ecosystem tags                                                      */
/* ------------------------------------------------------------------ */

export const ECOSYSTEM_TAGS: { id: EcosystemTag; label: string; labelAr: string }[] = [
  { id: "skywards", label: "Emirates Skywards", labelAr: "سكاي واردز" },
  { id: "etihad_guest", label: "Etihad Guest", labelAr: "ضيف الاتحاد" },
  { id: "maf_share", label: "MAF SHARE", labelAr: "شير" },
  { id: "aldar_darna", label: "Aldar Darna", labelAr: "دارنا" },
  { id: "noon", label: "Noon", labelAr: "نون" },
  { id: "talabat", label: "Talabat", labelAr: "طلبات" },
  { id: "careem", label: "Careem", labelAr: "كريم" },
  { id: "adnoc", label: "ADNOC", labelAr: "أدنوك" },
  { id: "cinema_bogo", label: "Cinema BOGO", labelAr: "سينما ١+١" },
  { id: "airport_lounge", label: "Airport Lounge", labelAr: "صالات المطار" },
  { id: "valet", label: "Valet Parking", labelAr: "صف السيارات" },
  { id: "golf", label: "Golf", labelAr: "الغولف" },
];

/** Explicit tags plus tags derived from scraper `lifestyle_perks`. */
export function cardTags(card: Card): Set<EcosystemTag> {
  const tags = new Set<EcosystemTag>(card.ecosystem_tags ?? []);
  const p = card.lifestyle_perks;
  if (p.lounge_access) tags.add("airport_lounge");
  if (p.valet_parking) tags.add("valet");
  if (p.golf_access) tags.add("golf");
  if (p.cinema_offers && /buy\s*1|bogo|1\s*\+\s*1/i.test(p.cinema_offers)) tags.add("cinema_bogo");
  return tags;
}

/* ------------------------------------------------------------------ */
/* Fees                                                                */
/* ------------------------------------------------------------------ */

export function isFirstYearFree(card: Card): boolean {
  if (card.is_free_for_life) return false;
  if (card.first_year_free !== undefined) return card.first_year_free;
  return /first\s*year\s*free/i.test(card.annual_fee_waiver_condition ?? "");
}

export function feeCategory(card: Card): FeeFilter {
  if (card.is_free_for_life || card.annual_fee_aed === 0) return "free_for_life";
  if (isFirstYearFree(card)) return "first_year_free";
  return "premium";
}

/** Ongoing (year 2+) annual fee used in net-value maths. */
export function ongoingFee(card: Card): number {
  return card.is_free_for_life ? 0 : card.annual_fee_aed ?? 0;
}

/* ------------------------------------------------------------------ */
/* Rewards maths                                                       */
/* ------------------------------------------------------------------ */

export const SPEND_CATEGORIES: (keyof MonthlySpend)[] = [
  "groceries",
  "fuel",
  "dining",
  "utilities",
  "education",
  "international",
  "other",
];

export const EMPTY_SPEND: MonthlySpend = {
  groceries: 0,
  fuel: 0,
  dining: 0,
  utilities: 0,
  education: 0,
  international: 0,
  other: 0,
};

export const DEFAULT_SPEND: MonthlySpend = {
  groceries: 2500,
  fuel: 600,
  dining: 1200,
  utilities: 900,
  education: 0,
  international: 1000,
  other: 1500,
};

export function totalSpend(s: MonthlySpend): number {
  return SPEND_CATEGORIES.reduce((sum, k) => sum + (s[k] || 0), 0);
}

export interface RewardBreakdown {
  monthlyRewards: number;
  annualRewards: number;
  annualFee: number;
  annualFxCost: number;
  netAnnual: number;
  capHit: boolean;
  /** false when spend is below `min_monthly_spend_aed`, so base rate applies. */
  headlineUnlocked: boolean;
}

/**
 * Net annual AED value = 12 x monthly rewards - ongoing annual fee - FX fees
 * on international spend.
 *
 * - Category rewards are limited by `monthly_cap_aed` (combined cap).
 * - The base `other_percent` on uncategorised spend is treated as uncapped.
 * - Below `min_monthly_spend_aed`, every category earns only the base rate.
 */
export function computeRewards(card: Card, spend: MonthlySpend): RewardBreakdown {
  const r = card.cashback_rates;
  const base = r.other_percent ?? 0;
  const intlRate = r.international_percent ?? base;
  const total = totalSpend(spend);
  const headlineUnlocked = !card.min_monthly_spend_aed || total >= card.min_monthly_spend_aed;

  const rate = (headline: number | null | undefined) => (headlineUnlocked ? headline ?? base : Math.min(headline ?? base, base));

  const categorised =
    (spend.groceries * rate(r.groceries_percent) +
      spend.fuel * rate(r.fuel_percent) +
      spend.dining * rate(r.dining_percent) +
      spend.utilities * rate(r.utilities_telecom_percent) +
      spend.education * rate(r.education_percent) +
      spend.international * rate(intlRate)) /
    100;

  const cap = r.monthly_cap_aed && r.monthly_cap_aed > 0 ? r.monthly_cap_aed : Infinity;
  const cappedCategorised = Math.min(categorised, cap);
  const monthlyRewards = cappedCategorised + (spend.other * base) / 100;

  const annualRewards = monthlyRewards * 12;
  const annualFee = ongoingFee(card);
  const annualFxCost = (spend.international * (card.fx_fee_percent ?? 0) * 12) / 100;

  return {
    monthlyRewards,
    annualRewards,
    annualFee,
    annualFxCost,
    netAnnual: annualRewards - annualFee - annualFxCost,
    capHit: categorised > cap,
    headlineUnlocked,
  };
}

/* ------------------------------------------------------------------ */
/* Filtering + sorting                                                 */
/* ------------------------------------------------------------------ */

export const SALARY_MIN = 5000;
export const SALARY_MAX = 50000;

export interface FilterState {
  salary: number;
  cardType: CardTypeFilter;
  fees: FeeFilter[];
  tags: EcosystemTag[];
  query: string;
}

export function isEligible(card: Card, salary: number): boolean {
  return salary >= SALARY_MAX || (card.min_salary_aed ?? 0) <= salary;
}

/** Hard filters remove cards. Salary does NOT remove: it greys out. */
export function matchesFilters(card: Card, f: FilterState): boolean {
  if (f.cardType === "islamic" && !card.is_islamic) return false;
  if (f.cardType === "conventional" && card.is_islamic) return false;
  if (f.fees.length && !f.fees.includes(feeCategory(card))) return false;
  if (f.tags.length) {
    const tags = cardTags(card);
    if (!f.tags.some((t) => tags.has(t))) return false;
  }
  if (f.query.trim()) {
    const q = f.query.trim().toLowerCase();
    const hay = `${card.card_name} ${BANKS[card.bank_name]?.name ?? card.bank_name} ${card.network} ${card.tier}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

export function sortCards(
  cards: Card[],
  sort: SortKey,
  salary: number,
  spend: MonthlySpend,
): Card[] {
  const net = new Map(cards.map((c) => [c.id, computeRewards(c, spend).netAnnual]));
  const typical = new Map(cards.map((c) => [c.id, computeRewards(c, DEFAULT_SPEND).netAnnual]));
  return [...cards].sort((a, b) => {
    // Eligible cards always float above ineligible ones.
    const ea = isEligible(a, salary) ? 0 : 1;
    const eb = isEligible(b, salary) ? 0 : 1;
    if (ea !== eb) return ea - eb;
    switch (sort) {
      case "net_value":
        return net.get(b.id)! - net.get(a.id)!;
      case "fee_asc":
        return ongoingFee(a) - ongoingFee(b);
      case "salary_asc":
        return (a.min_salary_aed ?? Infinity) - (b.min_salary_aed ?? Infinity) || 0;
      default: {
        // "Recommended": net value for a typical UAE household spend profile.
        return typical.get(b.id)! - typical.get(a.id)!;
      }
    }
  });
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

export function aed(n: number | null | undefined, locale = "en"): string {
  if (n === null || n === undefined) return "—";
  const fmt = new Intl.NumberFormat(locale === "ar" ? "ar-AE" : "en-AE", {
    maximumFractionDigits: 0,
  });
  return `AED ${fmt.format(Math.round(n))}`;
}

export function pct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0$/, "")}%`;
}
