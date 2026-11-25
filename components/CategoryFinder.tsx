"use client";

import {
  Fuel,
  GraduationCap,
  Plane,
  Search,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Target,
  TriangleAlert,
  UtensilsCrossed,
  X,
  Zap,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BANKS, aed, pct } from "@/lib/cards";
import {
  FINDER_CATEGORIES,
  matchCategory,
  rankForCategory,
  type FinderCategory,
  type RateSource,
} from "@/lib/categoryFinder";
import type { DictKey } from "@/lib/i18n";
import { CardArt } from "./CardArt";
import { useStore } from "./store";

export const FINDER_ICONS: Record<FinderCategory, LucideIcon> = {
  telecom: Smartphone,
  utilities: Zap,
  groceries: ShoppingCart,
  fuel: Fuel,
  dining: UtensilsCrossed,
  travel: Plane,
  online: ShoppingBag,
  education: GraduationCap,
  other: Wallet,
};

const NOTES: Partial<Record<FinderCategory, DictKey>> = {
  telecom: "note_telecom",
  utilities: "note_utilities",
  travel: "note_travel",
  online: "note_online",
  other: "note_other",
};

const SOURCE_LABEL: Record<RateSource, DictKey> = {
  category: "rateCategory",
  base: "rateBase",
  none: "rateNone",
};

const SOURCE_STYLE: Record<RateSource, string> = {
  category: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  base: "bg-amber-50 text-amber-800 ring-amber-600/20",
  none: "bg-slate-100 text-slate-500 ring-slate-400/20",
};

export function CategoryFinder() {
  const { t, state, dispatch, allCards, isEligible } = useStore();
  const open = state.finderOpen;
  const category = state.finderCategory;
  const [query, setQuery] = useState("");
  const close = () => dispatch({ type: "finderOpen", value: false });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dispatch({ type: "finderOpen", value: false });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dispatch]);

  const matched = useMemo(() => matchCategory(query), [query]);
  useEffect(() => {
    if (matched && matched !== category) dispatch({ type: "finderCategory", value: matched });
  }, [matched, category, dispatch]);

  const ranked = useMemo(
    () => rankForCategory(allCards, category, state.salary),
    [allCards, category, state.salary],
  );
  const withRate = ranked.filter((r) => r.rate !== null);
  const noRate = ranked.filter((r) => r.rate === null);
  const max = Math.max(1, ...withRate.map((r) => r.rate ?? 0));
  const note = NOTES[category];

  return (
    <div className={`fixed inset-0 z-50 transition ${open ? "visible" : "invisible"}`} aria-hidden={!open}>
      <div
        className={`absolute inset-0 bg-slate-900/40 transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
        onClick={close}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="finder-title"
        className={`absolute inset-y-0 end-0 flex w-full max-w-lg flex-col bg-white shadow-2xl transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full rtl:-translate-x-full"
        }`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 id="finder-title" className="inline-flex items-center gap-2 font-display text-lg font-bold text-navy-900">
              <Target className="size-5 text-emerald-600" aria-hidden />
              {t("finderTitle")}
            </h2>
            <p className="mt-1 text-xs text-slate-500">{t("finderSub")}</p>
          </div>
          <button type="button" onClick={close} aria-label={t("close")} className="rounded-full p-2 hover:bg-slate-100">
            <X className="size-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/15">
            <Search className="size-4 shrink-0 text-slate-400" aria-hidden />
            <span className="sr-only">{t("finderSearch")}</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("finderSearch")}
              className="w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
            />
          </label>
          {query.trim() && (
            <p className={`mt-1.5 text-xs ${matched ? "text-emerald-700" : "text-amber-700"}`} aria-live="polite">
              {matched ? `${t("finderMatched")}: ${t(`cat_${matched}`)}` : t("finderNoMatch")}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("finderTitle")}>
            {FINDER_CATEGORIES.map(({ id }) => {
              const Icon = FINDER_ICONS[id];
              const active = id === category;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => {
                    setQuery("");
                    dispatch({ type: "finderCategory", value: id });
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    active
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : "border-slate-200 text-slate-600 hover:border-emerald-500 hover:text-emerald-700"
                  }`}
                >
                  <Icon className="size-3.5" aria-hidden />
                  {t(`cat_${id}`)}
                </button>
              );
            })}
          </div>

          {note && <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">{t(note)}</p>}

          <p className="mt-4 text-xs text-slate-500">
            <strong className="tabular-nums text-slate-800">{ranked.length}</strong> {t("cardsRanked")} ·{" "}
            <strong className="tabular-nums text-emerald-700">{withRate.length}</strong> {t("withRate")}
          </p>

          <ol className="mt-2 space-y-2">
            {withRate.map((r, i) => (
              row(r, i + 1)
            ))}
          </ol>

          {noRate.length > 0 && (
            <>
              <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {t("rateNone")} ({noRate.length})
              </h3>
              <ol className="space-y-2">
                {noRate.map((r, i) => (
                  row(r, withRate.length + i + 1)
                ))}
              </ol>
            </>
          )}
        </div>
      </aside>
    </div>
  );

  function row(r: ReturnType<typeof rankForCategory>[number], rank: number) {
    const c = r.card;
    const eligible = isEligible(c);
    const bank = BANKS[c.bank_name];
    const cap = c.cashback_rates.monthly_cap_aed;
    return (
      <li key={c.id} className={`rounded-2xl border border-slate-200 p-3 ${eligible ? "" : "opacity-60"}`}>
        <div className="flex items-center gap-3">
          <span className="w-6 shrink-0 text-center font-display text-sm font-bold text-slate-400 tabular-nums">{rank}</span>
          <div className="w-14 shrink-0">
            <CardArt card={c} size="xs" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-navy-900 [unicode-bidi:plaintext] ltr:text-left rtl:text-right">
              {c.card_name}
            </p>
            <p className="truncate text-[11px] text-slate-500">
              {state.locale === "ar" ? bank?.nameAr : bank?.name}
            </p>
            {r.rate !== null && (
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full ${r.source === "category" ? "bg-emerald-500" : "bg-amber-400"}`}
                  style={{ width: `${Math.max(2, (r.rate / max) * 100)}%` }}
                />
              </div>
            )}
          </div>
          <span
            dir="ltr"
            className={`shrink-0 font-display text-base font-bold tabular-nums ${r.rate === null ? "text-slate-300" : "text-emerald-700"}`}
          >
            {pct(r.rate)}
          </span>
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 ps-9 text-[11px] text-slate-500 tabular-nums">
          <span
            className={`rounded-full px-2 py-0.5 font-semibold ring-1 ring-inset ${SOURCE_STYLE[r.source]}`}
            title={r.source === "base" && category !== "online" && category !== "other" ? t("rateBaseHint") : undefined}
          >
            {t(SOURCE_LABEL[r.source])}
          </span>
          {r.source === "category" && cap ? (
            <span>
              {t("capShort")} {aed(cap, state.locale)}
              {t("perMonth")}
            </span>
          ) : null}
          {r.rate !== null && c.min_monthly_spend_aed ? (
            <span>
              {t("minSpendShort")} {aed(c.min_monthly_spend_aed, state.locale)}
              {t("perMonth")}
            </span>
          ) : null}
          {category === "travel" && c.fx_fee_percent != null && (
            <span>
              {t("fxFee")} <span dir="ltr">{pct(c.fx_fee_percent)}</span>
            </span>
          )}
          {!eligible && (
            <span className="inline-flex items-center gap-1 text-amber-700">
              <TriangleAlert className="size-3" aria-hidden />
              {t("notEligible")} {aed(c.min_salary_aed, state.locale)}
            </span>
          )}
        </p>
      </li>
    );
  }
}
