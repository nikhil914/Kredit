"use client";

import {
  Calculator,
  Fuel,
  Globe,
  GraduationCap,
  ShoppingBag,
  ShoppingCart,
  TriangleAlert,
  UtensilsCrossed,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useEffect } from "react";
import { SPEND_CATEGORIES, aed, totalSpend } from "@/lib/cards";
import type { MonthlySpend } from "@/lib/types";
import { CardArt } from "./CardArt";
import { useStore } from "./store";

const ICONS: Record<keyof MonthlySpend, LucideIcon> = {
  groceries: ShoppingCart,
  fuel: Fuel,
  dining: UtensilsCrossed,
  utilities: Zap,
  education: GraduationCap,
  international: Globe,
  other: ShoppingBag,
};

const PRESETS: { key: "preset_family" | "preset_commuter" | "preset_traveller"; spend: MonthlySpend }[] = [
  {
    key: "preset_family",
    spend: { groceries: 4000, fuel: 800, dining: 1500, utilities: 1500, education: 3000, international: 500, other: 2000 },
  },
  {
    key: "preset_commuter",
    spend: { groceries: 1500, fuel: 1500, dining: 1000, utilities: 700, education: 0, international: 0, other: 1000 },
  },
  {
    key: "preset_traveller",
    spend: { groceries: 1500, fuel: 300, dining: 2000, utilities: 800, education: 0, international: 6000, other: 2500 },
  },
];

export function SpendCalculator() {
  const { t, state, dispatch, visible, rewards, isEligible } = useStore();
  const open = state.calculatorOpen;
  const close = () => dispatch({ type: "calculatorOpen", value: false });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dispatch({ type: "calculatorOpen", value: false });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dispatch]);

  const ranked = [...visible]
    .filter(isEligible)
    .sort((a, b) => rewards.get(b.id)!.netAnnual - rewards.get(a.id)!.netAnnual)
    .slice(0, 5);
  const max = Math.max(1, ...ranked.map((c) => rewards.get(c.id)!.netAnnual));

  return (
    <div
      className={`fixed inset-0 z-50 transition ${open ? "visible" : "invisible"}`}
      aria-hidden={!open}
    >
      <div
        className={`absolute inset-0 bg-slate-900/40 transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
        onClick={close}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="calc-title"
        className={`absolute inset-y-0 end-0 flex w-full max-w-md flex-col bg-white shadow-2xl transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full rtl:-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 id="calc-title" className="inline-flex items-center gap-2 font-display text-lg font-bold text-navy-900">
            <Calculator className="size-5 text-emerald-600" aria-hidden />
            {t("calculator")}
          </h2>
          <button type="button" onClick={close} aria-label={t("close")} className="rounded-full p-2 hover:bg-slate-100">
            <X className="size-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">{t("monthlySpend")}</h3>
            <div className="flex gap-1">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => dispatch({ type: "setSpend", value: p.spend })}
                  className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:border-emerald-500 hover:text-emerald-700"
                >
                  {t(p.key)}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            {SPEND_CATEGORIES.map((k) => {
              const Icon = ICONS[k];
              return (
                <label key={k} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/15">
                  <Icon className="size-4 shrink-0 text-navy-600" aria-hidden />
                  <span className="flex-1 text-sm text-slate-700">{t(k)}</span>
                  <span className="text-xs text-slate-400">AED</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={100}
                    value={state.spend[k] || ""}
                    placeholder="0"
                    onChange={(e) => dispatch({ type: "spend", key: k, value: Number(e.target.value) })}
                    className="w-24 bg-transparent text-end font-display text-sm font-semibold tabular-nums text-navy-900 outline-none"
                  />
                </label>
              );
            })}
          </div>
          <p className="mt-2 text-end text-xs text-slate-500">
            {t("total")}: <strong className="tabular-nums text-slate-800">{aed(totalSpend(state.spend), state.locale)}</strong>
            {t("perMonth")}
          </p>

          <h3 className="mb-3 mt-6 text-sm font-semibold text-slate-800">{t("topPicks")}</h3>
          <ol className="space-y-2.5">
            {ranked.map((c, i) => {
              const r = rewards.get(c.id)!;
              return (
                <li key={c.id} className="rounded-2xl border border-slate-200 p-3">
                  <div className="flex items-center gap-3">
                    <span className="font-display text-sm font-bold text-slate-400 tabular-nums">{i + 1}</span>
                    <div className="w-14 shrink-0">
                      <CardArt card={c} size="xs" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate [unicode-bidi:plaintext] ltr:text-left rtl:text-right text-sm font-semibold text-navy-900">{c.card_name}</p>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-emerald-500"
                          style={{ width: `${Math.max(0, (r.netAnnual / max) * 100)}%` }}
                        />
                      </div>
                    </div>
                    <span
                      className={`font-display text-sm font-bold tabular-nums ${r.netAnnual >= 0 ? "text-emerald-700" : "text-rose-600"}`}
                    >
                      {aed(r.netAnnual, state.locale)}
                    </span>
                  </div>
                  <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 ps-7 text-[11px] text-slate-500 tabular-nums">
                    <span>
                      {t("rewards")} +{aed(r.annualRewards, state.locale)}
                    </span>
                    <span>
                      {t("fee")} −{aed(r.annualFee, state.locale)}
                    </span>
                    {r.annualFxCost > 0 && (
                      <span>
                        {t("fxCost")} −{aed(r.annualFxCost, state.locale)}
                      </span>
                    )}
                    {r.capHit && (
                      <span className="inline-flex items-center gap-1 text-amber-700">
                        <TriangleAlert className="size-3" aria-hidden />
                        {t("capHit")}
                      </span>
                    )}
                    {!r.headlineUnlocked && (
                      <span className="inline-flex items-center gap-1 text-amber-700">
                        <TriangleAlert className="size-3" aria-hidden />
                        {t("belowMinSpend")}
                      </span>
                    )}
                  </p>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="border-t border-slate-200 p-4">
          <button
            type="button"
            onClick={() => {
              dispatch({ type: "sort", value: "net_value" });
              close();
            }}
            className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            {t("sortByValue")}
          </button>
        </div>
      </aside>
    </div>
  );
}
