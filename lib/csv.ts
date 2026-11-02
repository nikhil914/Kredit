/**
 * Flat CSV <-> card mapping for spreadsheet editing and bulk import.
 * Lists use " | " as the separator inside a cell. No runtime imports, so the
 * CLI can load this with Node type stripping.
 */
import type { Card } from "./types";

export const CSV_COLUMNS = [
  "id",
  "card_name",
  "bank_name",
  "is_islamic",
  "network",
  "tier",
  "min_salary_aed",
  "annual_fee_aed",
  "is_free_for_life",
  "first_year_free",
  "annual_fee_waiver_condition",
  "monthly_interest_rate_percent",
  "fx_fee_percent",
  "welcome_bonus",
  "reward_type",
  "key_benefits",
  "groceries_percent",
  "fuel_percent",
  "dining_percent",
  "utilities_telecom_percent",
  "education_percent",
  "international_percent",
  "other_percent",
  "monthly_cap_aed",
  "min_monthly_spend_aed",
  "early_cancellation_fee_aed",
  "lounge_access",
  "cinema_offers",
  "golf_access",
  "valet_parking",
  "valet_locations",
  "ecosystem_tags",
  "apply_url",
  "source_urls",
  "art_from",
  "art_to",
  "last_verified",
  "hidden",
] as const;

/** RFC 4180 parser: quoted fields, escaped quotes, CRLF/LF, BOM. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ""])));
}

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  const s = Array.isArray(v) ? v.join(" | ") : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function cardToRow(c: Card): Record<(typeof CSV_COLUMNS)[number], unknown> {
  const r = c.cashback_rates;
  const p = c.lifestyle_perks;
  return {
    id: c.id,
    card_name: c.card_name,
    bank_name: c.bank_name,
    is_islamic: c.is_islamic,
    network: c.network,
    tier: c.tier,
    min_salary_aed: c.min_salary_aed,
    annual_fee_aed: c.annual_fee_aed,
    is_free_for_life: c.is_free_for_life,
    first_year_free: c.first_year_free,
    annual_fee_waiver_condition: c.annual_fee_waiver_condition,
    monthly_interest_rate_percent: c.monthly_interest_rate_percent,
    fx_fee_percent: c.fx_fee_percent,
    welcome_bonus: c.welcome_bonus,
    reward_type: c.reward_type,
    key_benefits: c.key_benefits,
    groceries_percent: r.groceries_percent,
    fuel_percent: r.fuel_percent,
    dining_percent: r.dining_percent,
    utilities_telecom_percent: r.utilities_telecom_percent,
    education_percent: r.education_percent,
    international_percent: r.international_percent,
    other_percent: r.other_percent,
    monthly_cap_aed: r.monthly_cap_aed,
    min_monthly_spend_aed: c.min_monthly_spend_aed,
    early_cancellation_fee_aed: c.early_cancellation_fee_aed,
    lounge_access: p.lounge_access,
    cinema_offers: p.cinema_offers,
    golf_access: p.golf_access,
    valet_parking: p.valet_parking,
    valet_locations: p.valet_locations,
    ecosystem_tags: c.ecosystem_tags,
    apply_url: c.apply_url,
    source_urls: c.source_urls,
    art_from: c.art?.from,
    art_to: c.art?.to,
    last_verified: c.last_verified,
    hidden: c.hidden ? true : "",
  };
}

export function cardsToCsv(cards: Card[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const c of cards) {
    const row = cardToRow(c);
    lines.push(CSV_COLUMNS.map((k) => cell(row[k])).join(","));
  }
  return lines.join("\n") + "\n";
}
