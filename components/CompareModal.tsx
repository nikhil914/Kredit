"use client";

import { Check, Minus, X } from "lucide-react";
import { useEffect, useRef } from "react";
import {
  BANKS,
  DEFAULT_SPEND,
  aed,
  cardTags,
  computeRewards,
  ongoingFee,
  pct,
} from "@/lib/cards";
import { DICTS, type DictKey } from "@/lib/i18n";
import type { Card } from "@/lib/types";
import { CardArt } from "./CardArt";
import { useStore } from "./store";

type Better = "low" | "high" | null;

interface Row {
  label: DictKey | string;
  /** Numeric value used to rank cells; null = not comparable. */
  num?: (c: Card) => number | null;
  show: (c: Card) => React.ReactNode;
  better: Better;
}

export function CompareModal() {
  const { t, state, dispatch, allCards, hasSpend } = useStore();
  const dialogRef = useRef<HTMLDivElement>(null);
  const open = state.compareOpen && state.compare.length >= 2;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dispatch({ type: "compareOpen", value: false });
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, dispatch]);

  if (!open) return null;

  const cards = state.compare.map((id) => allCards.find((c) => c.id === id)!).filter(Boolean);
  const spend = hasSpend ? state.spend : DEFAULT_SPEND;
  const net = (c: Card) => computeRewards(c, spend).netAnnual;
  const L = state.locale;
  const bool = (v: boolean) =>
    v ? (
      <Check className="mx-auto size-4 text-emerald-600" aria-label={t("yes")} />
    ) : (
      <Minus className="mx-auto size-4 text-slate-300" aria-label={t("no")} />
    );
  const rate = (pick: (c: Card) => number | null | undefined): Pick<Row, "num" | "show" | "better"> => ({
    num: (c) => pick(c) ?? c.cashback_rates.other_percent ?? 0,
    show: (c) => pct(pick(c) ?? c.cashback_rates.other_percent ?? 0),
    better: "high",
  });

  const sections: { title: string; rows: Row[] }[] = [
    {
      title: L === "ar" ? "القيمة" : "Value",
      rows: [
        {
          label: `${t("netValue")}${hasSpend ? "" : L === "ar" ? " (إنفاق نموذجي)" : " (typical spend)"}`,
          num: net,
          show: (c) => aed(net(c), L),
          better: "high",
        },
        { label: "welcomeBonus", show: (c) => c.welcome_bonus ?? "—", better: null },
        { label: "rewardType", show: (c) => c.reward_type.join(", ").replace("_", " "), better: null },
      ],
    },
    {
      title: L === "ar" ? "الأهلية والرسوم" : "Eligibility & fees",
      rows: [
        { label: "minSalary", num: (c) => c.min_salary_aed, show: (c) => aed(c.min_salary_aed, L), better: "low" },
        {
          label: "fee",
          num: ongoingFee,
          show: (c) => (c.is_free_for_life ? t("free") : aed(c.annual_fee_aed, L)),
          better: "low",
        },
        {
          label: "interest",
          num: (c) => c.monthly_interest_rate_percent,
          show: (c) => pct(c.monthly_interest_rate_percent),
          better: "low",
        },
        { label: "fxFee", num: (c) => c.fx_fee_percent, show: (c) => pct(c.fx_fee_percent), better: "low" },
        {
          label: "minSpend",
          num: (c) => c.min_monthly_spend_aed ?? 0,
          show: (c) => (c.min_monthly_spend_aed ? aed(c.min_monthly_spend_aed, L) : t("none")),
          better: "low",
        },
        {
          label: "earlyCancel",
          num: (c) => c.early_cancellation_fee_aed ?? 0,
          show: (c) => (c.early_cancellation_fee_aed ? aed(c.early_cancellation_fee_aed, L) : t("none")),
          better: "low",
        },
      ],
    },
    {
      title: L === "ar" ? "نسب المكافآت" : "Reward rates",
      rows: [
        { label: "groceries", ...rate((c) => c.cashback_rates.groceries_percent) },
        { label: "fuel", ...rate((c) => c.cashback_rates.fuel_percent) },
        { label: "dining", ...rate((c) => c.cashback_rates.dining_percent) },
        { label: "utilities", ...rate((c) => c.cashback_rates.utilities_telecom_percent) },
        { label: "education", ...rate((c) => c.cashback_rates.education_percent) },
        { label: "international", ...rate((c) => c.cashback_rates.international_percent) },
        { label: "other", ...rate((c) => c.cashback_rates.other_percent) },
        {
          label: "monthlyCap",
          num: (c) => c.cashback_rates.monthly_cap_aed || Infinity,
          show: (c) => (c.cashback_rates.monthly_cap_aed ? aed(c.cashback_rates.monthly_cap_aed, L) : t("uncapped")),
          better: "high",
        },
      ],
    },
    {
      title: L === "ar" ? "أسلوب الحياة" : "Lifestyle",
      rows: [
        { label: "lounge", num: (c) => +!!c.lifestyle_perks.lounge_access, show: (c) => c.lifestyle_perks.lounge_access ?? bool(false), better: "high" },
        { label: "cinema", num: (c) => +!!c.lifestyle_perks.cinema_offers, show: (c) => c.lifestyle_perks.cinema_offers ?? bool(false), better: "high" },
        { label: "golf", num: (c) => +c.lifestyle_perks.golf_access, show: (c) => bool(c.lifestyle_perks.golf_access), better: "high" },
        { label: "valet", num: (c) => +c.lifestyle_perks.valet_parking, show: (c) => bool(c.lifestyle_perks.valet_parking), better: "high" },
        { label: "ecosystem", show: (c) => [...cardTags(c)].join(" · ").replaceAll("_", " "), better: null },
      ],
    },
  ];

  const tone = (row: Row, c: Card): string => {
    if (!row.num || !row.better) return "";
    const vals = cards.map(row.num).filter((v): v is number => v !== null);
    const uniq = new Set(vals);
    if (uniq.size < 2) return "";
    const v = row.num(c);
    if (v === null) return "";
    const best = row.better === "high" ? Math.max(...vals) : Math.min(...vals);
    const worst = row.better === "high" ? Math.min(...vals) : Math.max(...vals);
    if (v === best) return "bg-emerald-50 text-emerald-800 font-semibold";
    if (v === worst) return "bg-rose-50 text-rose-700";
    return "";
  };

  const label = (l: string) => (l in DICTS.en ? t(l as DictKey) : l);
  const close = () => dispatch({ type: "compareOpen", value: false });

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={close} />
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="compare-title"
        className="relative flex max-h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl outline-none sm:rounded-3xl"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 id="compare-title" className="font-display text-lg font-bold text-navy-900">
            {t("compareTitle")}
          </h2>
          <div className="flex items-center gap-4">
            <span className="hidden items-center gap-3 text-xs text-slate-500 sm:flex">
              <span className="inline-flex items-center gap-1">
                <span className="size-2.5 rounded-sm bg-emerald-200" /> {t("better")}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="size-2.5 rounded-sm bg-rose-200" /> {t("worse")}
              </span>
            </span>
            <button type="button" onClick={close} aria-label={t("close")} className="rounded-full p-2 hover:bg-slate-100">
              <X className="size-5" />
            </button>
          </div>
        </div>

        <div className="overflow-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-white/95 backdrop-blur">
              <tr>
                <th className="sticky start-0 z-[1] w-28 bg-white p-4 sm:w-44" />
                {cards.map((c) => (
                  <th key={c.id} className="min-w-[160px] p-4 align-top">
                    <div className="mx-auto max-w-[180px]">
                      <CardArt card={c} size="sm" />
                    </div>
                    <p className="mt-2 text-xs font-medium text-slate-500">
                      {L === "ar" ? BANKS[c.bank_name]?.nameAr : BANKS[c.bank_name]?.name}
                    </p>
                    <p className="font-display text-sm font-bold text-navy-900 [overflow-wrap:anywhere]">{c.card_name}</p>
                    <span
                      className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        c.is_islamic ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {c.is_islamic ? t("islamicBadge") : t("conventionalBadge")}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sections.map((s) => (
                <SectionRows key={s.title} title={s.title} span={cards.length + 1}>
                  {s.rows.map((row) => (
                    <tr key={String(row.label)} className="border-t border-slate-100">
                      <th scope="row" className="sticky start-0 z-[1] bg-white p-3 ps-5 text-start text-xs font-medium text-slate-500 shadow-[1px_0_0_0_var(--color-slate-100)] rtl:shadow-[-1px_0_0_0_var(--color-slate-100)]">
                        {label(String(row.label))}
                      </th>
                      {cards.map((c) => (
                        <td key={c.id} className={`p-3 text-center tabular-nums text-slate-800 ${tone(row, c)}`}>
                          {row.show(c)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </SectionRows>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex gap-2 border-t border-slate-200 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4">
          {cards.map((c) => (
            <a
              key={c.id}
              href={c.apply_url ?? c.source_urls[0]}
              target="_blank"
              rel="noopener noreferrer"
              title={`${t("apply")}: ${c.card_name}`}
              className="flex min-w-0 flex-1 flex-col items-center rounded-xl bg-navy-900 px-3 py-2 text-center text-white transition hover:bg-navy-700"
            >
              <span className="text-xs font-semibold sm:text-sm">{t("applyShort")}</span>
              <span className="w-full truncate text-[10.5px] font-medium text-white/70 sm:text-xs">{c.card_name}</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

function SectionRows({ title, span, children }: { title: string; span: number; children: React.ReactNode }) {
  return (
    <>
      <tr>
        <th
          colSpan={span}
          className="bg-slate-50 py-2 text-start text-[11px] font-bold uppercase tracking-wider text-slate-500"
        >
          <span className="sticky start-0 inline-block px-5">{title}</span>
        </th>
      </tr>
      {children}
    </>
  );
}
