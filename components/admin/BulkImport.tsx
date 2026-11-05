"use client";

import { FileUp, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { parseCsv } from "@/lib/csv";
import type { Card } from "@/lib/types";
import { extractCardArray, planImport } from "@/lib/validate";

type Rows = Record<string, unknown>[];

/** Larger files would freeze the tab; the real data set is ~250 KB. */
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

function parseInput(text: string, filename = ""): Rows {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const looksJson = filename.toLowerCase().endsWith(".json") || /^[[{]/.test(trimmed);
  return looksJson ? extractCardArray(JSON.parse(trimmed)) : parseCsv(trimmed);
}

export function BulkImport({ cards, onApply }: { cards: Card[]; onApply: (next: Card[], summary: string) => void }) {
  const [source, setSource] = useState<{ name: string; text: string } | null>(null);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [asDrafts, setAsDrafts] = useState(true);
  const [dragging, setDragging] = useState(false);

  const parsed = useMemo(() => {
    if (!source) return null;
    try {
      return { rows: parseInput(source.text, source.name), error: null as string | null };
    } catch (e) {
      return { rows: [] as Rows, error: (e as Error).message };
    }
  }, [source]);

  const plan = useMemo(
    () => (parsed && parsed.rows.length ? planImport(cards, parsed.rows, mode, asDrafts) : null),
    [parsed, cards, mode, asDrafts],
  );

  const [tooBig, setTooBig] = useState(false);
  const readFile = async (f: File) => {
    setTooBig(f.size > MAX_IMPORT_BYTES);
    if (f.size > MAX_IMPORT_BYTES) return;
    setSource({ name: f.name, text: await f.text() });
  };
  const removed = plan && mode === "replace" ? cards.filter((c) => !plan.result.some((r) => r.id === c.id)) : [];

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-display text-base font-bold text-navy-900">Bulk import</h2>
        <p className="mt-1 text-sm text-slate-600">
          Upload a <b>CSV</b> (use the template from Export) or a <b>JSON</b> array, such as the scraper&apos;s{" "}
          <code className="rounded bg-slate-100 px-1">cards_extended.json</code>. Rows are matched by <code className="rounded bg-slate-100 px-1">id</code>,
          or by an id derived from <code className="rounded bg-slate-100 px-1">card_name</code>. Nothing is published until you
          press Publish.
        </p>

        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files[0];
            if (f) readFile(f);
          }}
          className={`mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-8 text-center transition ${
            dragging ? "border-emerald-500 bg-emerald-50" : "border-slate-300 hover:border-slate-400"
          }`}
        >
          <FileUp className="size-7 text-slate-400" aria-hidden />
          <span className="text-sm font-semibold text-slate-700">Drop a .csv or .json file, or click to choose</span>
          {source && <span className="text-xs text-emerald-700">Loaded: {source.name}</span>}
          {tooBig && <span className="text-xs text-rose-700">That file is over 5 MB. Split it and import the parts.</span>}
          <input
            type="file"
            accept=".csv,.json,text/csv,application/json"
            className="sr-only"
            onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])}
          />
        </label>

        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-600">Or paste CSV / JSON</summary>
          <textarea
            rows={6}
            className="input mt-2 font-mono text-xs"
            placeholder="card_name,bank_name,is_islamic,..."
            onChange={(e) => setSource({ name: "pasted", text: e.target.value })}
          />
        </details>

        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <fieldset className="flex items-center gap-3">
            <legend className="sr-only">Mode</legend>
            {(["merge", "replace"] as const).map((m) => (
              <label key={m} className="flex items-center gap-1.5">
                <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} className="accent-emerald-600" />
                {m === "merge" ? "Merge (update + add, keep the rest)" : "Replace all cards"}
              </label>
            ))}
          </fieldset>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={asDrafts} onChange={(e) => setAsDrafts(e.target.checked)} className="accent-emerald-600" />
            Keep invalid rows as hidden drafts to fix later
          </label>
        </div>
      </div>

      {parsed?.error && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">Could not read the file: {parsed.error}</p>
      )}

      {plan && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Stat n={parsed!.rows.length} label="rows read" />
            <Stat n={plan.added.length} label="new" tone="emerald" />
            <Stat n={plan.updated.length} label="updated" tone="navy" />
            <Stat n={plan.unchanged.length} label="unchanged" />
            <Stat n={plan.invalid.length} label={asDrafts ? "invalid (as drafts)" : "invalid (skipped)"} tone="rose" />
          </div>

          <div className="mt-4 max-h-80 space-y-1 overflow-y-auto text-sm">
            {plan.added.map((c) => (
              <Line key={`a-${c.id}`} sign="+" tone="text-emerald-700" title={c.card_name || c.id} detail={c.hidden ? "hidden draft" : c.bank_name} />
            ))}
            {plan.updated.map((u) => (
              <Line key={`u-${u.card.id}`} sign="~" tone="text-navy-700" title={u.card.card_name} detail={u.changed.join(", ")} />
            ))}
            {removed.map((c) => (
              <Line key={`r-${c.id}`} sign="-" tone="text-rose-700" title={c.card_name} detail="removed by Replace" />
            ))}
            {plan.invalid.map((b) => (
              <Line key={`x-${b.row}`} sign="x" tone="text-rose-700" title={`Row ${b.row}: ${b.name}`} detail={b.errors.join("; ")} />
            ))}
            {plan.warnings.map((w) => (
              <Line key={`w-${w.id}`} sign="!" tone="text-amber-700" title={w.id} detail={w.warnings.join("; ")} />
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <p className="text-sm text-slate-600">
              Dataset after import: <b className="tabular-nums">{plan.result.length}</b> cards
            </p>
            <button
              type="button"
              className="btn-emerald"
              disabled={plan.added.length + plan.updated.length + removed.length === 0}
              onClick={() => {
                onApply(
                  plan.result,
                  `Imported ${source?.name}: ${plan.added.length} new, ${plan.updated.length} updated, ${plan.invalid.length} invalid`,
                );
                setSource(null);
              }}
            >
              <Upload className="size-4" aria-hidden />
              Apply to working copy
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone?: "emerald" | "navy" | "rose" }) {
  const color = tone === "emerald" ? "text-emerald-700" : tone === "navy" ? "text-navy-700" : tone === "rose" ? "text-rose-700" : "text-slate-800";
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className={`font-display text-xl font-bold tabular-nums ${color}`}>{n}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}

function Line({ sign, tone, title, detail }: { sign: string; tone: string; title: string; detail: string }) {
  return (
    <p className="flex gap-2">
      <span className={`w-3 shrink-0 font-mono font-bold ${tone}`}>{sign}</span>
      <span className="min-w-0">
        <span className="font-medium text-slate-800">{title}</span>
        <span className="text-slate-500"> · {detail}</span>
      </span>
    </p>
  );
}
