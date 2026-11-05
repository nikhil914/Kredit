"use client";

import { X } from "lucide-react";
import { useEffect } from "react";
import { FilterSidebar } from "./FilterSidebar";
import { useStore } from "./store";

export function MobileFilters({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, eligibleCount } = useStore();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={t("filters")}>
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-3xl bg-slate-50 p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-display font-bold text-navy-900">{t("mobileFilters")}</span>
          <button type="button" onClick={onClose} aria-label={t("close")} className="rounded-full p-2 hover:bg-slate-200">
            <X className="size-5" />
          </button>
        </div>
        <FilterSidebar />
        <button
          type="button"
          onClick={onClose}
          className="sticky bottom-0 mt-4 w-full rounded-xl bg-navy-900 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-900/20"
        >
          {t("showCards")} ({eligibleCount})
        </button>
      </div>
    </div>
  );
}
