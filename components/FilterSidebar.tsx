"use client";

import { Check, RotateCcw } from "lucide-react";
import { ECOSYSTEM_TAGS, SALARY_MAX, SALARY_MIN, aed } from "@/lib/cards";
import type { CardTypeFilter, FeeFilter } from "@/lib/types";
import { useStore } from "./store";

const CARD_TYPES: CardTypeFilter[] = ["all", "islamic", "conventional"];
const FEES: FeeFilter[] = ["free_for_life", "first_year_free", "premium"];

export function FilterSidebar() {
  const { t, state, dispatch, activeFilterCount } = useStore();
  const fill = ((state.salary - SALARY_MIN) / (SALARY_MAX - SALARY_MIN)) * 100;
  const salaryLabel =
    state.salary >= SALARY_MAX ? `${aed(SALARY_MAX, state.locale)}+` : aed(state.salary, state.locale);

  return (
    <div className="space-y-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-base font-bold text-navy-900">{t("filters")}</h2>
        {activeFilterCount > 0 && (
          <button
            type="button"
            onClick={() => dispatch({ type: "resetFilters" })}
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-navy-700"
          >
            <RotateCcw className="size-3.5" aria-hidden />
            {t("reset")}
          </button>
        )}
      </div>

      {/* Salary */}
      <fieldset>
        <div className="flex items-baseline justify-between">
          <label htmlFor="salary" className="text-sm font-semibold text-slate-800">
            {t("salary")}
          </label>
          <output htmlFor="salary" className="font-display text-sm font-bold tabular-nums text-emerald-700">
            {salaryLabel}
          </output>
        </div>
        <input
          id="salary"
          type="range"
          min={SALARY_MIN}
          max={SALARY_MAX}
          step={1000}
          value={state.salary}
          onChange={(e) => dispatch({ type: "salary", value: Number(e.target.value) })}
          className="salary-range mt-3 w-full"
          style={{ "--fill": `${fill}%` } as React.CSSProperties}
        />
        <div className="mt-1.5 flex justify-between text-[11px] text-slate-400 tabular-nums">
          <span>5K</span>
          <span>25K</span>
          <span>50K+</span>
        </div>
        <p className="mt-2 text-xs text-slate-500">{t("salaryHint")}</p>
      </fieldset>

      {/* Card type */}
      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-slate-800">{t("cardType")}</legend>
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1" role="radiogroup">
          {CARD_TYPES.map((ct) => {
            const active = state.cardType === ct;
            return (
              <button
                key={ct}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => dispatch({ type: "cardType", value: ct })}
                className={`rounded-lg px-1 py-1.5 text-[11px] font-semibold transition ${
                  active ? "bg-white text-navy-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {t(ct)}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Fees */}
      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-slate-800">{t("annualFee")}</legend>
        <div className="space-y-1.5">
          {FEES.map((f) => {
            const checked = state.fees.includes(f);
            return (
              <label
                key={f}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1 text-sm text-slate-700 hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={checked}
                  onChange={() => dispatch({ type: "toggleFee", value: f })}
                />
                <span
                  className={`grid size-4.5 place-items-center rounded-md border transition peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500/40 ${
                    checked ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-white"
                  }`}
                  aria-hidden
                >
                  {checked && <Check className="size-3" strokeWidth={3} />}
                </span>
                {t(f)}
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Ecosystem tags */}
      <fieldset>
        <legend className="mb-1 text-sm font-semibold text-slate-800">{t("ecosystem")}</legend>
        <p className="mb-2.5 text-xs text-slate-500">{t("matchAny")}</p>
        <div className="flex flex-wrap gap-1.5">
          {ECOSYSTEM_TAGS.map((tag) => {
            const active = state.tags.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                aria-pressed={active}
                onClick={() => dispatch({ type: "toggleTag", value: tag.id })}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                  active
                    ? "border-navy-800 bg-navy-800 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-400"
                }`}
              >
                {state.locale === "ar" ? tag.labelAr : tag.label}
              </button>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}
