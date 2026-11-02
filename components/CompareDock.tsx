"use client";

import { Scale, X } from "lucide-react";
import { CardArt } from "./CardArt";
import { MAX_COMPARE, useStore } from "./store";

export function CompareDock() {
  const { t, state, dispatch, allCards } = useStore();
  if (state.compare.length === 0) return null;
  const selected = state.compare.map((id) => allCards.find((c) => c.id === id)!).filter(Boolean);
  const slots = Array.from({ length: MAX_COMPARE }, (_, i) => selected[i]);
  const canCompare = selected.length >= 2;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <div
        className="pointer-events-auto flex w-full max-w-2xl items-center gap-3 rounded-2xl border border-white/60 bg-white/70 p-2.5 shadow-2xl shadow-slate-900/20 ring-1 ring-slate-900/5 backdrop-blur-xl sm:gap-4 sm:p-3"
        role="region"
        aria-label={t("compareTitle")}
      >
        <ul className="flex flex-1 gap-2">
          {slots.map((card, i) => (
            <li key={card?.id ?? `empty-${i}`} className="relative w-full max-w-[110px]">
              {card ? (
                <>
                  <CardArt card={card} size="sm" />
                  <button
                    type="button"
                    onClick={() => dispatch({ type: "toggleCompare", id: card.id })}
                    className="absolute -end-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-slate-900 text-white shadow"
                    aria-label={`${t("clear")} ${card.card_name}`}
                  >
                    <X className="size-3" />
                  </button>
                </>
              ) : (
                <div className="grid aspect-[1.586] place-items-center rounded-lg border-2 border-dashed border-slate-300 text-lg text-slate-300">
                  +
                </div>
              )}
            </li>
          ))}
        </ul>
        <div className="flex shrink-0 flex-col items-stretch gap-1">
          <button
            type="button"
            disabled={!canCompare}
            onClick={() => dispatch({ type: "compareOpen", value: true })}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white transition enabled:hover:bg-navy-700 disabled:bg-slate-300"
            title={canCompare ? undefined : t("pickMore")}
          >
            <Scale className="size-4" aria-hidden />
            {t("compareN")} ({selected.length})
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: "clearCompare" })}
            className="text-xs font-medium text-slate-500 hover:text-slate-800"
          >
            {t("clear")}
          </button>
        </div>
      </div>
    </div>
  );
}
