import { ongoingFee } from "@/lib/cards";
import type { CashbackRates, Card } from "@/lib/types";

/**
 * "Which card should I use for X?"
 *
 * The scraped data only has a handful of rate fields, so each everyday
 * spend category the user can pick maps onto one of them. When a card has
 * no rate for that field we fall back to its base (other_percent) rate,
 * and say so in the UI.
 */

export type FinderCategory =
  | "telecom"
  | "utilities"
  | "groceries"
  | "fuel"
  | "dining"
  | "travel"
  | "online"
  | "education"
  | "other";

type RateField = Exclude<keyof CashbackRates, "monthly_cap_aed">;

export const FINDER_CATEGORIES: { id: FinderCategory; field: RateField }[] = [
  { id: "telecom", field: "utilities_telecom_percent" },
  { id: "utilities", field: "utilities_telecom_percent" },
  { id: "groceries", field: "groceries_percent" },
  { id: "fuel", field: "fuel_percent" },
  { id: "dining", field: "dining_percent" },
  { id: "travel", field: "international_percent" },
  { id: "online", field: "other_percent" },
  { id: "education", field: "education_percent" },
  { id: "other", field: "other_percent" },
];

/** Words people type, in English and Arabic, mapped to a category. */
const ALIASES: Record<FinderCategory, string[]> = {
  telecom: [
    "phone", "mobile", "recharge", "top up", "topup", "top-up", "telecom", "du", "etisalat", "e&",
    "virgin mobile", "sim", "prepaid", "postpaid", "internet", "broadband", "wifi",
    "هاتف", "جوال", "موبايل", "شحن", "رصيد", "اتصالات", "دو", "انترنت", "إنترنت",
  ],
  utilities: [
    "utility", "utilities", "bill", "bills", "dewa", "addc", "sewa", "fewa", "electricity", "water",
    "gas bill", "chiller", "empower", "salik", "rta",
    "فواتير", "فاتورة", "كهرباء", "ماء", "مياه", "ديوا",
  ],
  groceries: [
    "grocery", "groceries", "supermarket", "hypermarket", "carrefour", "lulu", "spinneys", "union coop",
    "waitrose", "choithrams", "nesto", "instashop", "food shopping",
    "بقالة", "سوبرماركت", "كارفور", "لولو", "تموين",
  ],
  fuel: [
    "fuel", "petrol", "gas station", "diesel", "adnoc", "enoc", "eppco", "emarat", "car fuel",
    "وقود", "بنزين", "ديزل", "أدنوك", "اينوك",
  ],
  dining: [
    "dining", "restaurant", "restaurants", "food", "cafe", "coffee", "talabat", "deliveroo", "careem food",
    "zomato", "noon food", "eat", "lunch", "dinner",
    "مطعم", "مطاعم", "طعام", "قهوة", "مقهى", "طلبات",
  ],
  travel: [
    "travel", "flight", "flights", "hotel", "hotels", "abroad", "foreign", "international", "overseas",
    "airline", "booking", "holiday", "vacation", "trip",
    "سفر", "طيران", "فندق", "فنادق", "خارج", "دولي", "رحلة",
  ],
  online: [
    "online", "shopping", "amazon", "noon", "namshi", "shein", "ecommerce", "e-commerce", "retail",
    "clothes", "electronics", "mall",
    "تسوق", "أونلاين", "اونلاين", "أمازون", "نون", "ملابس",
  ],
  education: [
    "school", "school fees", "education", "tuition", "university", "college", "nursery",
    "مدرسة", "رسوم مدرسية", "تعليم", "جامعة", "حضانة",
  ],
  other: ["other", "everything", "general", "anything", "كل شيء", "أخرى", "عام"],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Best category for free text, or null when nothing matches. */
export function matchCategory(query: string): FinderCategory | null {
  const q = norm(query);
  if (!q) return null;
  let best: { id: FinderCategory; score: number } | null = null;
  for (const { id } of FINDER_CATEGORIES) {
    for (const alias of ALIASES[id]) {
      const a = norm(alias);
      let score = 0;
      if (q === a) score = 100;
      else if (new RegExp(`(^|[^\\p{L}])${escapeRe(a)}($|[^\\p{L}])`, "u").test(q)) score = 50 + a.length;
      else if (a.length >= 3 && a.startsWith(q)) score = 20 + q.length;
      if (score && (!best || score > best.score)) best = { id, score };
    }
  }
  return best?.id ?? null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export type RateSource = "category" | "base" | "none";

export interface CategoryRate {
  card: Card;
  rate: number | null;
  source: RateSource;
}

export function rateFor(card: Card, category: FinderCategory): CategoryRate {
  const field = FINDER_CATEGORIES.find((c) => c.id === category)!.field;
  const r = card.cashback_rates;
  const specific = r[field];
  if (specific !== null && specific !== undefined) {
    return { card, rate: specific, source: field === "other_percent" ? "base" : "category" };
  }
  const base = r.other_percent;
  if (base !== null && base !== undefined) return { card, rate: base, source: "base" };
  return { card, rate: null, source: "none" };
}

/** Every card, best rate first. Cards with no published rate go last. */
export function rankForCategory(cards: Card[], category: FinderCategory, salary: number): CategoryRate[] {
  return cards
    .map((c) => rateFor(c, category))
    .sort((a, b) => {
      if (a.rate === null || b.rate === null) {
        if (a.rate !== b.rate) return a.rate === null ? 1 : -1;
      } else if (a.rate !== b.rate) return b.rate - a.rate;
      // Ties: a category-specific rate beats a base rate, then eligible, then cheaper.
      if (a.source !== b.source) return a.source === "category" ? -1 : b.source === "category" ? 1 : 0;
      const ea = (a.card.min_salary_aed ?? 0) <= salary ? 0 : 1;
      const eb = (b.card.min_salary_aed ?? 0) <= salary ? 0 : 1;
      if (ea !== eb) return ea - eb;
      return ongoingFee(a.card) - ongoingFee(b.card);
    });
}
