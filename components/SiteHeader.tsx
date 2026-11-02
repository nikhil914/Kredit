"use client";

import { Calculator, CreditCard, Languages } from "lucide-react";
import { useStore } from "./store";

export function SiteHeader() {
  const { t, state, dispatch } = useStore();
  const nextLocale = state.locale === "en" ? "ar" : "en";

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <a href="#" className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-navy-900 text-white">
            <CreditCard className="size-4" aria-hidden />
          </span>
          <span className="font-display text-lg font-bold tracking-tight text-navy-900">
            {t("brand")}
          </span>
        </a>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => dispatch({ type: "calculatorOpen", value: true })}
            className="hidden items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-navy-800 transition hover:border-navy-600 sm:inline-flex"
          >
            <Calculator className="size-4" aria-hidden />
            {t("calculator")}
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: "locale", value: nextLocale })}
            className="inline-flex items-center gap-2 rounded-full bg-navy-900 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-navy-700"
            aria-label={nextLocale === "ar" ? "Switch to Arabic" : "التبديل إلى الإنجليزية"}
          >
            <Languages className="size-4" aria-hidden />
            {nextLocale === "ar" ? "العربية" : "English"}
          </button>
        </div>
      </div>
    </header>
  );
}
