"use client";

import { CircleAlert, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cardToRow } from "@/lib/csv";
import type { Card } from "@/lib/types";
import {
  BANK_CODES,
  ECOSYSTEM_TAG_IDS,
  NETWORKS,
  REWARD_TYPES,
  TIERS,
  slugify,
  validateCard,
} from "@/lib/validate";
import { CardTile } from "../CardTile";
import { StoreProvider } from "../store";

type FormValue = string | boolean | string[];
type Form = Record<string, FormValue>;

const LINE_FIELDS = ["key_benefits", "valet_locations", "source_urls"];
const MULTI_FIELDS = ["reward_type", "ecosystem_tags"];
const BOOL_FIELDS = ["is_islamic", "is_free_for_life", "first_year_free", "golf_access", "valet_parking", "hidden"];

export const BLANK_CARD_FORM: Form = {
  bank_name: "ENBD",
  network: "Visa",
  tier: "Platinum",
  reward_type: ["Cashback"],
  last_verified: new Date().toISOString().slice(0, 10),
  hidden: true,
};

function toForm(card: Card): Form {
  const row = cardToRow(card) as Record<string, unknown>;
  const form: Form = {};
  for (const [k, v] of Object.entries(row)) {
    if (MULTI_FIELDS.includes(k)) form[k] = (v as string[] | undefined) ?? [];
    else if (LINE_FIELDS.includes(k)) form[k] = ((v as string[] | undefined) ?? []).join("\n");
    else if (BOOL_FIELDS.includes(k)) form[k] = v === true;
    else form[k] = v === null || v === undefined ? "" : String(v);
  }
  return form;
}

export function CardEditor({
  card,
  existingIds,
  onSave,
  onClose,
}: {
  /** null = new card */
  card: Card | null;
  existingIds: string[];
  onSave: (card: Card, originalId: string | null) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Form>(() => (card ? toForm(card) : { ...BLANK_CARD_FORM }));
  const [idTouched, setIdTouched] = useState(!!card);
  const [triedSave, setTriedSave] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = (k: string, v: FormValue) =>
    setForm((f) => {
      const next = { ...f, [k]: v };
      if (k === "card_name" && !idTouched) next.id = slugify(String(v));
      if (k === "is_free_for_life" && v === true) next.annual_fee_aed = "0";
      return next;
    });

  const result = useMemo(() => validateCard(form), [form]);
  const idClash = result.card.id !== card?.id && existingIds.includes(result.card.id);
  const errors = [...result.errors, ...(idClash ? [`id "${result.card.id}" is already used by another card`] : [])];
  const isDraft = form.hidden === true;
  const blocking = idClash || (!isDraft && result.errors.length > 0) || !result.card.id;

  const save = () => {
    setTriedSave(true);
    if (blocking) return;
    onSave(result.card, card?.id ?? null);
  };

  const text = (k: string, label: string, opts: { type?: string; hint?: string; step?: string } = {}) => (
    <Field label={label} hint={opts.hint}>
      <input
        type={opts.type ?? "text"}
        step={opts.step}
        value={String(form[k] ?? "")}
        onChange={(e) => {
          if (k === "id") setIdTouched(true);
          set(k, e.target.value);
        }}
        className="input"
      />
    </Field>
  );
  const select = (k: string, label: string, options: readonly string[]) => (
    <Field label={label}>
      <select value={String(form[k] ?? "")} onChange={(e) => set(k, e.target.value)} className="input">
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </Field>
  );
  const check = (k: string, label: string) => (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={form[k] === true}
        onChange={(e) => set(k, e.target.checked)}
        className="size-4 accent-emerald-600"
      />
      {label}
    </label>
  );
  const lines = (k: string, label: string, hint: string) => (
    <Field label={label} hint={hint} wide>
      <textarea
        rows={k === "key_benefits" ? 5 : 2}
        value={String(form[k] ?? "")}
        onChange={(e) => set(k, e.target.value)}
        className="input font-mono text-xs"
      />
    </Field>
  );
  const multi = (k: string, label: string, options: readonly string[]) => {
    const val = (form[k] as string[]) ?? [];
    return (
      <Field label={label} wide>
        <div className="flex flex-wrap gap-1.5">
          {options.map((o) => {
            const on = val.includes(o);
            return (
              <button
                key={o}
                type="button"
                aria-pressed={on}
                onClick={() => set(k, on ? val.filter((x) => x !== o) : [...val, o])}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                  on ? "border-navy-800 bg-navy-800 text-white" : "border-slate-200 text-slate-600 hover:border-slate-400"
                }`}
              >
                {o.replaceAll("_", " ")}
              </button>
            );
          })}
        </div>
      </Field>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Edit card">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative ms-auto flex h-full w-full max-w-6xl flex-col bg-slate-50 shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
          <div className="min-w-0">
            <h2 className="truncate font-display text-lg font-bold text-navy-900">
              {card ? `Edit: ${card.card_name}` : "New card"}
            </h2>
            <p className="text-xs text-slate-500">Changes stay in this browser until you publish.</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button type="button" onClick={save} className="btn-primary" disabled={triedSave && blocking}>
              Save card
            </button>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 hover:bg-slate-100">
              <X className="size-5" />
            </button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[1fr_360px]">
          <div className="space-y-5 overflow-y-auto p-5">
            {(errors.length > 0 || result.warnings.length > 0) && (
              <div className="space-y-2">
                {errors.length > 0 && (
                  <Notice tone="error" title={isDraft ? "Errors (allowed while saved as a hidden draft)" : "Fix these to publish"}>
                    {errors}
                  </Notice>
                )}
                {result.warnings.length > 0 && (
                  <Notice tone="warn" title="Warnings">
                    {result.warnings}
                  </Notice>
                )}
              </div>
            )}

            <Section title="Identity">
              {text("card_name", "Card name")}
              {text("id", "ID (URL slug)", { hint: "Auto-filled from the name" })}
              {select("bank_name", "Bank", BANK_CODES)}
              {select("network", "Network", NETWORKS)}
              {select("tier", "Tier", TIERS)}
              <div className="flex flex-col justify-end gap-2 pb-1">
                {check("is_islamic", "Islamic (Sharia-compliant)")}
                {check("hidden", "Draft (hidden from site)")}
              </div>
            </Section>

            <Section title="Eligibility & fees">
              {text("min_salary_aed", "Min salary (AED)", { type: "number" })}
              {text("annual_fee_aed", "Annual fee (AED, incl. VAT)", { type: "number" })}
              <div className="flex flex-col justify-end gap-2 pb-1">
                {check("is_free_for_life", "Free for life")}
                {check("first_year_free", "First year free")}
              </div>
              {text("annual_fee_waiver_condition", "Fee waiver condition")}
              {text("monthly_interest_rate_percent", "Monthly interest / profit rate %", { type: "number", step: "0.01" })}
              {text("fx_fee_percent", "Foreign transaction fee %", { type: "number", step: "0.01" })}
              {text("min_monthly_spend_aed", "Spend to unlock headline rates (AED/mo)", { type: "number" })}
              {text("early_cancellation_fee_aed", "Early cancellation fee (AED)", { type: "number" })}
            </Section>

            <Section title="Rewards">
              {multi("reward_type", "Reward type", REWARD_TYPES)}
              {text("welcome_bonus", "Welcome bonus")}
              {text("monthly_cap_aed", "Combined monthly cap (AED, blank = none)", { type: "number" })}
              {lines(
                "key_benefits",
                "Key benefits (one per line, top 3 show on the tile)",
                'Write caps as "5% on groceries - capped at AED 200/mo" to highlight them',
              )}
              {text("groceries_percent", "Groceries %", { type: "number", step: "0.05" })}
              {text("fuel_percent", "Fuel %", { type: "number", step: "0.05" })}
              {text("dining_percent", "Dining %", { type: "number", step: "0.05" })}
              {text("utilities_telecom_percent", "Utilities & telecom %", { type: "number", step: "0.05" })}
              {text("education_percent", "School fees %", { type: "number", step: "0.05" })}
              {text("international_percent", "International %", { type: "number", step: "0.05" })}
              {text("other_percent", "Everything else %", { type: "number", step: "0.05" })}
            </Section>

            <Section title="Lifestyle">
              {text("lounge_access", "Lounge access")}
              {text("cinema_offers", "Cinema offers")}
              <div className="flex flex-col justify-end gap-2 pb-1">
                {check("golf_access", "Golf access")}
                {check("valet_parking", "Valet parking")}
              </div>
              {lines("valet_locations", "Valet locations (one per line)", "")}
              {multi("ecosystem_tags", "Ecosystem tags", ECOSYSTEM_TAG_IDS)}
            </Section>

            <Section title="Links & look">
              {text("apply_url", "Apply URL (https://)")}
              {text("last_verified", "Last verified", { type: "date" })}
              {lines("source_urls", "Source URLs (one per line)", "Bank product pages you checked")}
              <Field label="Card colours">
                <div className="flex items-center gap-2">
                  {(["art_from", "art_to"] as const).map((k) => (
                    <input
                      key={k}
                      type="color"
                      value={String(form[k] || "#0f1f4d")}
                      onChange={(e) => set(k, e.target.value)}
                      className="h-9 w-14 cursor-pointer rounded border border-slate-200"
                      aria-label={k}
                    />
                  ))}
                </div>
              </Field>
            </Section>
          </div>

          <aside className="hidden overflow-y-auto border-s border-slate-200 bg-white p-5 lg:block">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Live preview</p>
            <StoreProvider cards={[result.card]} syncDocument={false}>
              <PreviewTile card={result.card} />
            </StoreProvider>
          </aside>
        </div>
      </div>
    </div>
  );
}

function PreviewTile({ card }: { card: Card }) {
  // Preview should never look "ineligible" because of the default salary.
  return (
    <div className="pointer-events-none">
      <CardTile card={{ ...card, min_salary_aed: Math.min(card.min_salary_aed ?? 0, 5000) }} />
      <p className="mt-2 text-xs text-slate-500">Min salary shown as eligible in preview.</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <h3 className="mb-3 font-display text-sm font-bold text-navy-900">{title}</h3>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}

function Field({ label, hint, wide, children }: { label: string; hint?: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={`block ${wide ? "sm:col-span-2 xl:col-span-3" : ""}`}>
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

export function Notice({ tone, title, children }: { tone: "error" | "warn"; title: string; children: string[] }) {
  const Icon = tone === "error" ? CircleAlert : TriangleAlert;
  return (
    <div
      className={`rounded-xl border p-3 text-sm ${
        tone === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-amber-200 bg-amber-50 text-amber-800"
      }`}
    >
      <p className="mb-1 flex items-center gap-1.5 font-semibold">
        <Icon className="size-4" aria-hidden />
        {title}
      </p>
      <ul className="list-disc space-y-0.5 ps-6 text-[13px]">
        {children.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    </div>
  );
}
