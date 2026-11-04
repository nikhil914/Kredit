"use client";

import {
  Armchair,
  BadgePercent,
  Car,
  Check,
  ChevronDown,
  CircleCheck,
  ExternalLink,
  Film,
  Flag,
  Fuel,
  Gift,
  Globe,
  GraduationCap,
  Lock,
  Moon,
  Plane,
  ScanEye,
  ShoppingCart,
  Sparkles,
  TriangleAlert,
  UtensilsCrossed,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { BANKS, aed, feeCategory, pct } from "@/lib/cards";
import type { Card } from "@/lib/types";
import { BankMono, CardArt } from "./CardArt";
import { MAX_COMPARE, useStore } from "./store";

const PERK_ICONS: [RegExp, LucideIcon][] = [
  [/lounge|airport/i, Armchair],
  [/mile|skywards|etihad|travel/i, Plane],
  [/grocer/i, ShoppingCart],
  [/fuel|adnoc|enoc/i, Fuel],
  [/dining|restaurant|talabat/i, UtensilsCrossed],
  [/cinema|vox|reel|roxy/i, Film],
  [/golf/i, Flag],
  [/valet|careem|parking/i, Car],
  [/school|education/i, GraduationCap],
  [/telecom|utilit/i, Zap],
  [/abroad|foreign|international/i, Globe],
  [/sharia|covered|islamic/i, Moon],
  [/free for life|no annual fee/i, Gift],
  [/cashback|points|%/i, BadgePercent],
];

function perkIcon(text: string): LucideIcon {
  return PERK_ICONS.find(([re]) => re.test(text))?.[1] ?? Sparkles;
}

/** Splits "5% on X - capped at AED 200/mo" into the perk and its hidden cap. */
function splitCap(text: string): [string, string | null] {
  const m = text.match(/^(.*?)\s*[-–—]\s*((?:capped|cap|max).*)$/i);
  return m ? [m[1], m[2]] : [text, null];
}

export function CardTile({ card, rank }: { card: Card; rank?: number }) {
  const { t, state, dispatch, isEligible, rewards, hasSpend } = useStore();
  const [xrayOpen, setXrayOpen] = useState(false);
  const xrayId = useId();
  const eligible = isEligible(card);
  const selected = state.compare.includes(card.id);
  const compareFull = state.compare.length >= MAX_COMPARE && !selected;
  const r = rewards.get(card.id)!;
  const fee = feeCategory(card);
  const bankName = state.locale === "ar" ? BANKS[card.bank_name]?.nameAr : BANKS[card.bank_name]?.name;

  return (
    <article
      className={`group relative flex h-full flex-col rounded-3xl border bg-white p-4 shadow-sm transition ${
        selected ? "border-emerald-500 ring-2 ring-emerald-500/20" : "border-slate-200 hover:shadow-md"
      } ${eligible ? "" : "opacity-60 grayscale"}`}
      aria-label={card.card_name}
    >
      {!eligible && (
        <div className="absolute end-4 top-4 z-10 inline-flex items-center gap-1 rounded-full bg-slate-900/85 px-2.5 py-1 text-[11px] font-semibold text-white">
          <Lock className="size-3" aria-hidden />
          {t("notEligible")} {aed(card.min_salary_aed, state.locale)}
        </div>
      )}
      {rank !== undefined && eligible && (
        <div className="absolute start-4 top-4 z-10 rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white">
          #{rank}
        </div>
      )}

      <div className="mx-auto w-full max-w-[300px] px-2 pt-2">
        <CardArt card={card} />
      </div>

      <header className="mt-4 flex items-start gap-3">
        <BankMono card={card} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-slate-500">{bankName}</p>
          <h3 className="[unicode-bidi:plaintext] ltr:text-left rtl:text-right font-display text-[15px] font-bold leading-snug text-navy-900">{card.card_name}</h3>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                card.is_islamic ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
              }`}
            >
              {card.is_islamic && <Moon className="size-3" aria-hidden />}
              {card.is_islamic ? t("islamicBadge") : t("conventionalBadge")}
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
              {card.network} {card.tier}
            </span>
          </div>
        </div>
      </header>

      {/* Hero metrics */}
      <dl className="mt-4 grid grid-cols-3 gap-2">
        <Metric label={t("minSalary")} value={aed(card.min_salary_aed, state.locale)} />
        <Metric
          label={t("fee")}
          value={card.is_free_for_life ? t("free") : aed(card.annual_fee_aed, state.locale)}
          note={fee === "first_year_free" ? t("firstYearFree") : undefined}
          good={card.is_free_for_life}
        />
        <Metric label={t("interest")} value={pct(card.monthly_interest_rate_percent)} />
      </dl>

      {/* Top 3 perks */}
      <ul className="mt-4 space-y-2">
        {card.key_benefits.slice(0, 3).map((b) => {
          const [perk, cap] = splitCap(b);
          const Icon = perkIcon(b);
          return (
            <li key={b} className="flex gap-2.5 text-[13px] leading-snug text-slate-700">
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg bg-navy-50 text-navy-700">
                <Icon className="size-3.5" aria-hidden />
              </span>
              <span className="[unicode-bidi:plaintext] ltr:text-left rtl:text-right">
                {perk}
                {cap && (
                  <span className="ms-1.5 inline-flex items-center rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">
                    {cap}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {/* Net value from the calculator */}
      {hasSpend && (
        <div className="mt-4 flex items-center justify-between rounded-xl bg-gradient-to-r from-emerald-50 to-white px-3 py-2">
          <span className="text-xs font-medium text-emerald-800">{t("netValue")}</span>
          <span
            className={`font-display text-base font-bold tabular-nums ${
              r.netAnnual >= 0 ? "text-emerald-700" : "text-rose-600"
            }`}
          >
            {r.netAnnual >= 0 ? "+" : "−"}
            {aed(Math.abs(r.netAnnual), state.locale)}
          </span>
        </div>
      )}

      {/* Hidden Fees X-Ray */}
      <div className="mt-4 rounded-xl border border-slate-200">
        <button
          type="button"
          aria-expanded={xrayOpen}
          aria-controls={xrayId}
          onClick={() => setXrayOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-start text-[13px] font-semibold text-slate-700"
        >
          <span className="inline-flex items-center gap-2">
            <ScanEye className="size-4 text-amber-600" aria-hidden />
            {t("xray")}
          </span>
          <ChevronDown className={`size-4 text-slate-400 transition ${xrayOpen ? "rotate-180" : ""}`} aria-hidden />
        </button>
        {xrayOpen && (
          <dl id={xrayId} className="space-y-2 border-t border-slate-100 px-3 py-3 text-[13px]">
            <XrayRow
              label={t("fxFee")}
              value={pct(card.fx_fee_percent)}
              warn={(card.fx_fee_percent ?? 0) >= 2.75}
            />
            <XrayRow
              label={t("waiver")}
              value={card.is_free_for_life ? t("none") : card.annual_fee_waiver_condition ?? t("noneStated")}
            />
            <XrayRow
              label={t("minSpend")}
              value={card.min_monthly_spend_aed ? `${aed(card.min_monthly_spend_aed, state.locale)}${t("perMonth")}` : t("none")}
              warn={!!card.min_monthly_spend_aed}
            />
            <XrayRow
              label={t("earlyCancel")}
              value={card.early_cancellation_fee_aed ? aed(card.early_cancellation_fee_aed, state.locale) : t("none")}
              warn={!!card.early_cancellation_fee_aed}
            />
          </dl>
        )}
      </div>

      {/* CTAs */}
      <div className="mt-auto flex gap-2 pt-4">
        <label
          className={`inline-flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
            selected
              ? "border-emerald-600 bg-emerald-50 text-emerald-800"
              : compareFull
                ? "cursor-not-allowed border-slate-200 text-slate-400"
                : "border-slate-300 text-slate-700 hover:border-navy-600"
          }`}
          title={compareFull ? t("maxCompare") : undefined}
        >
          <input
            type="checkbox"
            className="peer sr-only"
            checked={selected}
            onChange={() => dispatch({ type: "toggleCompare", id: card.id })}
          />
          <span
            className={`grid size-4 place-items-center rounded border peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500/40 ${
              selected ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300"
            }`}
            aria-hidden
          >
            {selected && <Check className="size-3" strokeWidth={3} />}
          </span>
          {t("compare")}
        </label>
        <a
          href={eligible ? card.apply_url ?? card.source_urls[0] : undefined}
          target="_blank"
          rel="noopener noreferrer"
          aria-disabled={!eligible}
          className={`inline-flex flex-[1.6] items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-center text-sm font-semibold transition ${
            eligible
              ? "bg-navy-900 text-white hover:bg-navy-700"
              : "pointer-events-none bg-slate-200 text-slate-500"
          }`}
        >
          {eligible ? <CircleCheck className="size-4" aria-hidden /> : <Lock className="size-4" aria-hidden />}
          <span className="truncate">{t("apply")}</span>
          {eligible && <ExternalLink className="size-3.5 opacity-60 rtl:-scale-x-100" aria-hidden />}
        </a>
      </div>
    </article>
  );
}

function Metric({ label, value, note, good }: { label: string; value: string; note?: string; good?: boolean }) {
  return (
    <div className="rounded-xl bg-slate-50 px-2.5 py-2">
      <dt className="text-[10.5px] font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`mt-0.5 font-display text-[13px] font-bold tabular-nums ${good ? "text-emerald-700" : "text-navy-900"}`}>
        {value}
      </dd>
      {note && <dd className="text-[10.5px] font-semibold text-emerald-700">{note}</dd>}
    </div>
  );
}

function XrayRow({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="flex items-center gap-1.5 text-slate-500">
        {warn && <TriangleAlert className="size-3.5 shrink-0 text-amber-500" aria-hidden />}
        {label}
      </dt>
      <dd className="[unicode-bidi:plaintext] ltr:text-right rtl:text-left font-semibold text-slate-800">{value}</dd>
    </div>
  );
}
