/**
 * Card validation + normalisation shared by the admin dashboard and the
 * bulk-import CLI (scripts/import-cards.mts).
 *
 * Accepts loosely-typed input (JSON from the scraper, CSV rows, form state)
 * and returns a normalised card plus errors (block publishing) and warnings
 * (published, but worth a look).
 *
 * Keep this file free of runtime imports so Node can run it directly with
 * type stripping.
 */
import type { Card } from "./types";

export const BANK_CODES = ["ENBD", "FAB", "ADCB", "ADIB", "Mashreq", "HSBC", "Citi", "RAKBANK", "DIB", "EI", "CBD"] as const;
export const NETWORKS = ["Visa", "Mastercard", "Amex", "Diners"] as const;
export const TIERS = ["Classic", "Titanium", "Platinum", "Signature", "World", "Infinite", "World Elite"] as const;
export const REWARD_TYPES = ["Cashback", "AirMiles", "Points", "Retail_Cobrand"] as const;
export const ECOSYSTEM_TAG_IDS = [
  "skywards",
  "etihad_guest",
  "maf_share",
  "aldar_darna",
  "noon",
  "talabat",
  "careem",
  "adnoc",
  "cinema_bogo",
  "airport_lounge",
  "valet",
  "golf",
] as const;

/** Common aliases seen in scraped data, mapped to schema enum values. */
const BANK_ALIASES: Record<string, (typeof BANK_CODES)[number]> = {
  "emirates nbd": "ENBD",
  enbd: "ENBD",
  "first abu dhabi bank": "FAB",
  fab: "FAB",
  adcb: "ADCB",
  "abu dhabi commercial bank": "ADCB",
  adib: "ADIB",
  "abu dhabi islamic bank": "ADIB",
  mashreq: "Mashreq",
  hsbc: "HSBC",
  citi: "Citi",
  citibank: "Citi",
  rakbank: "RAKBANK",
  dib: "DIB",
  "dubai islamic bank": "DIB",
  ei: "EI",
  "emirates islamic": "EI",
  cbd: "CBD",
  "commercial bank of dubai": "CBD",
};

export interface ValidationResult {
  card: Card;
  errors: string[];
  warnings: string[];
}

type Loose = Record<string, unknown>;

const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
}

function toNumber(v: unknown): number | null {
  if (isBlank(v)) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[,%\s]|AED/gi, ""));
  return Number.isFinite(n) ? n : null;
}

function toBool(v: unknown): boolean | null {
  if (isBlank(v)) return null;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (["true", "yes", "y", "1"].includes(s)) return true;
  if (["false", "no", "n", "0"].includes(s)) return false;
  return null;
}

/** Arrays may arrive as arrays, or as "a | b" (CSV) / one-per-line (form) strings. */
function toList(v: unknown): string[] {
  if (isBlank(v)) return [];
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  return String(v)
    .split(/\s*[|\n]\s*/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function toStr(v: unknown): string | null {
  return isBlank(v) ? null : String(v).trim();
}

function matchEnum<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  const s = toStr(v);
  if (!s) return null;
  return allowed.find((a) => a.toLowerCase() === s.toLowerCase()) ?? null;
}

export function validateCard(input: Loose): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const lp = (input.lifestyle_perks ?? {}) as Loose;
  const cr = (input.cashback_rates ?? {}) as Loose;
  const art = (input.art ?? {}) as Loose;

  // ---- identity -----------------------------------------------------------
  const card_name = toStr(input.card_name) ?? "";
  if (!card_name) errors.push("card_name is required");

  const id = toStr(input.id) ? slugify(String(input.id)) : slugify(card_name);
  if (!id) errors.push("id is required (or a card_name to derive it from)");

  const bankRaw = toStr(input.bank_name);
  const bank_name =
    matchEnum(bankRaw, BANK_CODES) ?? (bankRaw ? BANK_ALIASES[bankRaw.toLowerCase()] : undefined) ?? null;
  if (!bank_name) errors.push(`bank_name "${bankRaw ?? ""}" must be one of ${BANK_CODES.join(", ")}`);

  const network = matchEnum(input.network, NETWORKS);
  if (!network) errors.push(`network "${toStr(input.network) ?? ""}" must be one of ${NETWORKS.join(", ")}`);

  const tier = matchEnum(input.tier, TIERS);
  if (!tier) errors.push(`tier "${toStr(input.tier) ?? ""}" must be one of ${TIERS.join(", ")}`);

  const is_islamic = toBool(input.is_islamic);
  if (is_islamic === null) errors.push("is_islamic must be true/false");

  // ---- fees + eligibility -------------------------------------------------
  const min_salary_aed = toNumber(input.min_salary_aed);
  if (min_salary_aed === null) errors.push("min_salary_aed is required");
  else if (min_salary_aed < 0) errors.push("min_salary_aed cannot be negative");
  else if (min_salary_aed > 0 && min_salary_aed < 3000) warnings.push(`min_salary_aed ${min_salary_aed} looks low for a UAE card`);

  let is_free_for_life = toBool(input.is_free_for_life);
  let annual_fee_aed = toNumber(input.annual_fee_aed);
  if (annual_fee_aed === null && is_free_for_life) annual_fee_aed = 0;
  if (annual_fee_aed === null) errors.push("annual_fee_aed is required (0 if free)");
  if (is_free_for_life === null) {
    is_free_for_life = annual_fee_aed === 0;
    warnings.push("is_free_for_life missing; inferred from annual_fee_aed");
  }
  if (is_free_for_life && annual_fee_aed) errors.push("is_free_for_life is true but annual_fee_aed is not 0");

  const monthly_interest_rate_percent = toNumber(input.monthly_interest_rate_percent);
  if (monthly_interest_rate_percent === null) errors.push("monthly_interest_rate_percent is required");
  else if (monthly_interest_rate_percent > 5) warnings.push(`monthly_interest_rate_percent ${monthly_interest_rate_percent}% looks like an annual rate`);

  const fx_fee_percent = toNumber(input.fx_fee_percent);
  if (fx_fee_percent === null) errors.push("fx_fee_percent is required");
  else if (fx_fee_percent > 5) warnings.push(`fx_fee_percent ${fx_fee_percent}% is unusually high`);

  // ---- rewards ------------------------------------------------------------
  const rewardRaw = toList(input.reward_type);
  const reward_type = rewardRaw
    .map((r) => matchEnum(r.replace(/\s+/g, "_"), REWARD_TYPES) ?? matchEnum(r, REWARD_TYPES))
    .filter((r): r is (typeof REWARD_TYPES)[number] => !!r);
  if (rewardRaw.length !== reward_type.length)
    warnings.push(`unknown reward_type dropped (allowed: ${REWARD_TYPES.join(", ")})`);
  if (!reward_type.length) errors.push("reward_type needs at least one value");

  const key_benefits = toList(input.key_benefits);
  if (key_benefits.length < 3) warnings.push("fewer than 3 key_benefits; card tile shows the top 3");
  if (key_benefits.length > 5) warnings.push("more than 5 key_benefits; schema allows max 5");

  const rate = (k: string) => {
    const n = toNumber(cr[k] ?? input[k]);
    if (n !== null && (n < 0 || n > 25)) warnings.push(`${k} ${n}% is outside 0-25%`);
    return n;
  };
  const intl = rate("international_percent");
  const other = rate("other_percent");
  const cashback_rates = {
    groceries_percent: rate("groceries_percent") ?? 0,
    fuel_percent: rate("fuel_percent") ?? 0,
    dining_percent: rate("dining_percent") ?? 0,
    utilities_telecom_percent: rate("utilities_telecom_percent") ?? 0,
    education_percent: rate("education_percent") ?? 0,
    monthly_cap_aed: toNumber(cr.monthly_cap_aed ?? input.monthly_cap_aed) || null,
    ...(intl !== null ? { international_percent: intl } : {}),
    ...(other !== null ? { other_percent: other } : {}),
  };

  const tags = toList(input.ecosystem_tags);
  const ecosystem_tags = tags.filter((t): t is (typeof ECOSYSTEM_TAG_IDS)[number] =>
    (ECOSYSTEM_TAG_IDS as readonly string[]).includes(t),
  );
  if (tags.length !== ecosystem_tags.length)
    warnings.push(`unknown ecosystem_tags dropped: ${tags.filter((t) => !ecosystem_tags.includes(t as never)).join(", ")}`);

  const source_urls = toList(input.source_urls);
  const apply_url = toStr(input.apply_url);
  for (const u of [...source_urls, ...(apply_url ? [apply_url] : [])]) {
    if (!/^https:\/\//i.test(u)) errors.push(`URL must start with https://: ${u}`);
  }
  if (!source_urls.length) warnings.push("no source_urls; add the bank page for traceability");

  const hex = (v: unknown) => {
    const s = toStr(v);
    return s && /^#[0-9a-f]{6}$/i.test(s) ? s : null;
  };
  const artFrom = hex(art.from ?? input.art_from);
  const artTo = hex(art.to ?? input.art_to);

  const card = {
    id,
    card_name,
    bank_name,
    is_islamic: !!is_islamic,
    network,
    tier,
    min_salary_aed,
    annual_fee_aed,
    is_free_for_life: !!is_free_for_life,
    annual_fee_waiver_condition: toStr(input.annual_fee_waiver_condition),
    monthly_interest_rate_percent,
    fx_fee_percent,
    welcome_bonus: toStr(input.welcome_bonus),
    reward_type,
    key_benefits,
    lifestyle_perks: {
      lounge_access: toStr(lp.lounge_access ?? input.lounge_access),
      cinema_offers: toStr(lp.cinema_offers ?? input.cinema_offers),
      golf_access: !!toBool(lp.golf_access ?? input.golf_access),
      valet_parking: !!toBool(lp.valet_parking ?? input.valet_parking),
      valet_locations: toList(lp.valet_locations ?? input.valet_locations),
    },
    cashback_rates,
    source_urls,
    // ---- optional extensions (omitted when empty) ----
    ...(toBool(input.first_year_free) !== null ? { first_year_free: toBool(input.first_year_free)! } : {}),
    min_monthly_spend_aed: toNumber(input.min_monthly_spend_aed),
    early_cancellation_fee_aed: toNumber(input.early_cancellation_fee_aed),
    ...(apply_url ? { apply_url } : {}),
    ...(ecosystem_tags.length ? { ecosystem_tags } : {}),
    ...(artFrom && artTo ? { art: { from: artFrom, to: artTo, ink: "light" as const } } : {}),
    ...(toStr(input.last_verified) ? { last_verified: toStr(input.last_verified)! } : {}),
    ...(toBool(input.hidden) ? { hidden: true } : {}),
  } as unknown as Card;

  return { card, errors, warnings };
}

/** Accepts a JSON array, or an object with a `cards` array (scraper output). */
export function extractCardArray(json: unknown): Loose[] {
  if (Array.isArray(json)) return json as Loose[];
  if (json && typeof json === "object" && Array.isArray((json as Loose).cards)) return (json as Loose).cards as Loose[];
  throw new Error("Expected a JSON array of cards, or an object with a `cards` array");
}

export interface ImportPlan {
  added: Card[];
  updated: { card: Card; changed: string[] }[];
  unchanged: Card[];
  invalid: { row: number; name: string; errors: string[]; card: Card }[];
  warnings: { id: string; warnings: string[] }[];
  /** Resulting dataset if applied. */
  result: Card[];
}

const stable = (v: unknown) => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));

/**
 * Upsert `rows` into `existing` by id.
 *  - mode "merge": existing cards not in the import are kept.
 *  - mode "replace": the import becomes the whole dataset.
 *  - invalid rows are skipped unless `invalidAsHidden`, in which case they are
 *    stored with `hidden: true` so they never render until fixed in the admin.
 */
export function planImport(
  existing: Card[],
  rows: Loose[],
  mode: "merge" | "replace" = "merge",
  invalidAsHidden = false,
): ImportPlan {
  const byId = new Map(existing.map((c) => [c.id, c]));
  const plan: ImportPlan = { added: [], updated: [], unchanged: [], invalid: [], warnings: [], result: [] };
  const seen = new Map<string, Card>();

  rows.forEach((raw, i) => {
    const { card, errors, warnings } = validateCard(raw);
    if (seen.has(card.id)) errors.push(`duplicate id "${card.id}" in this import`);
    if (errors.length) {
      plan.invalid.push({ row: i + 1, name: card.card_name || card.id || `row ${i + 1}`, errors, card });
      if (!invalidAsHidden || !card.id || seen.has(card.id)) return;
      (card as Card & { hidden?: boolean }).hidden = true;
    }
    if (warnings.length) plan.warnings.push({ id: card.id, warnings });
    seen.set(card.id, card);

    const prev = byId.get(card.id);
    if (!prev) plan.added.push(card);
    else {
      const changed = Object.keys({ ...prev, ...card }).filter(
        (k) => stable((prev as unknown as Loose)[k]) !== stable((card as unknown as Loose)[k]),
      );
      if (changed.length) plan.updated.push({ card, changed });
      else plan.unchanged.push(card);
    }
  });

  if (mode === "replace") plan.result = [...seen.values()];
  else {
    const merged = existing.map((c) => seen.get(c.id) ?? c);
    for (const c of seen.values()) if (!byId.has(c.id)) merged.push(c);
    plan.result = merged;
  }
  return plan;
}
