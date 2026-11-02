"use client";

import { ArrowUpDown, Calculator, Search, SlidersHorizontal, X } from "lucide-react";
import { ECOSYSTEM_TAGS } from "@/lib/cards";
import type { SortKey } from "@/lib/types";
import { useStore } from "./store";

const SORTS: SortKey[] = ["recommended", "net_value", "fee_asc", "salary_asc"];

export function TopBar({ onOpenFilters }: { onOpenFilters: () => void }) {
  const { t, state, dispatch, visible, eligibleCount, activeFilterCount } = useStore();

  const chips: { label: string; onRemove: () => void }[] = [
    ...(state.cardType !== "all"
      ? [{ label: t(state.cardType), onRemove: () => dispatch({ type: "cardType", value: "all" }) }]
      : []),
    ...state.fees.map((f) => ({ label: t(f), onRemove: () => dispatch({ type: "toggleFee", value: f }) })),
    ...state.tags.map((id) => {
      const tag = ECOSYSTEM_TAGS.find((x) => x.id === id)!;
      return {
        label: state.locale === "ar" ? tag.labelAr : tag.label,
        onRemove: () => dispatch({ type: "toggleTag", value: id }),
      };
    }),
  ];

  return (
    <div className="sticky top-16 z-30 -mx-4 bg-canvas/90 px-4 py-3 backdrop-blur-md sm:mx-0 sm:px-0">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            type="search"
            value={state.query}
            onChange={(e) => dispatch({ type: "query", value: e.target.value })}
            placeholder={t("search")}
            aria-label={t("search")}
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pe-3 ps-9 text-sm outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
          />
        </div>

        <button
          type="button"
          onClick={onOpenFilters}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 lg:hidden"
        >
          <SlidersHorizontal className="size-4" aria-hidden />
          {t("filters")}
          {activeFilterCount > 0 && (
            <span className="rounded-full bg-emerald-600 px-1.5 text-[11px] text-white">{activeFilterCount}</span>
          )}
        </button>

        <label className="relative inline-flex items-center">
          <span className="sr-only">{t("sort")}</span>
          <ArrowUpDown className="pointer-events-none absolute start-3 size-4 text-slate-400" aria-hidden />
          <select
            value={state.sort}
            onChange={(e) => dispatch({ type: "sort", value: e.target.value as SortKey })}
            className="appearance-none rounded-xl border border-slate-200 bg-white py-2.5 pe-4 ps-9 text-sm font-medium text-slate-700 outline-none focus:border-emerald-500"
          >
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`sort_${s}` as const)}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => dispatch({ type: "calculatorOpen", value: true })}
          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
        >
          <Calculator className="size-4" aria-hidden />
          <span className="hidden sm:inline">{t("calculator")}</span>
        </button>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-600">
          <strong className="font-semibold text-navy-900 tabular-nums">{visible.length}</strong> {t("results")} ·{" "}
          <strong className="font-semibold text-emerald-700 tabular-nums">{eligibleCount}</strong> {t("eligible")}
        </span>
        {chips.map((c) => (
          <button
            key={c.label}
            type="button"
            onClick={c.onRemove}
            className="inline-flex items-center gap-1 rounded-full bg-navy-50 px-2.5 py-0.5 text-xs font-medium text-navy-800 hover:bg-navy-100"
          >
            {c.label}
            <X className="size-3" aria-hidden />
          </button>
        ))}
      </div>
    </div>
  );
}
