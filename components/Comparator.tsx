"use client";

import { useState } from "react";
import { useStore } from "./store";
import { SiteHeader } from "./SiteHeader";
import { FilterSidebar } from "./FilterSidebar";
import { TopBar } from "./TopBar";
import { CardTile } from "./CardTile";
import { CompareDock } from "./CompareDock";
import { CompareModal } from "./CompareModal";
import { SpendCalculator } from "./SpendCalculator";
import { MobileFilters } from "./MobileFilters";
import { Info, ShieldCheck } from "lucide-react";

export function Comparator() {
  const { t, visible, allCards, state } = useStore();
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const bankCount = new Set(allCards.map((c) => c.bank_name)).size;

  return (
    <>
      <SiteHeader />

      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:py-14">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            <ShieldCheck className="size-3.5" aria-hidden />
            {t("tagline")}
          </p>
          <h1 className="max-w-3xl font-display text-3xl font-extrabold tracking-tight text-navy-900 sm:text-4xl lg:text-5xl">
            {t("heroTitle")}
          </h1>
          <p className="mt-4 max-w-2xl text-base text-slate-600 sm:text-lg">{t("heroSub")}</p>
          <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-4">
            {[
              [allCards.length, t("statCards")],
              [bankCount, t("statBanks")],
              [0, t("statGates")],
            ].map(([n, label]) => (
              <div key={label as string}>
                <dt className="sr-only">{label}</dt>
                <dd className="font-display text-2xl font-bold text-navy-900 tabular-nums">
                  {n}{" "}
                  <span className="text-sm font-medium text-slate-500">{label}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <main className="mx-auto max-w-7xl px-4 pb-40 pt-6 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
          <aside className="hidden lg:block" aria-label={t("filters")}>
            <div className="sticky top-20">
              <FilterSidebar />
            </div>
          </aside>

          <div className="min-w-0">
            <TopBar onOpenFilters={() => setMobileFiltersOpen(true)} />

            {visible.length === 0 ? (
              <p className="mt-10 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
                {t("noResults")}
              </p>
            ) : (
              <ul className="mt-4 grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-3">
                {visible.map((card, i) => (
                  <li key={card.id} className="min-w-0">
                    <CardTile card={card} rank={state.sort === "net_value" ? i + 1 : undefined} />
                  </li>
                ))}
              </ul>
            )}

            <p className="mt-10 flex items-start gap-2 text-xs leading-relaxed text-slate-500">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{t("disclaimer")}</span>
            </p>
          </div>
        </div>
      </main>

      <CompareDock />
      <CompareModal />
      <SpendCalculator />
      <MobileFilters open={mobileFiltersOpen} onClose={() => setMobileFiltersOpen(false)} />
      <Toast />
    </>
  );
}

function Toast() {
  const { state, t } = useStore();
  if (!state.toast) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-20 z-[70] mx-auto w-fit rounded-full bg-navy-900 px-4 py-2 text-sm font-medium text-white shadow-lg"
    >
      {t(state.toast as Parameters<typeof t>[0])}
    </div>
  );
}
