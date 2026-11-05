"use client";

import {
  CircleAlert,
  CircleCheck,
  Copy,
  CreditCard,
  Download,
  EyeOff,
  Eye,
  FileSpreadsheet,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BANKS, aed } from "@/lib/cards";
import { CSV_COLUMNS, cardsToCsv } from "@/lib/csv";
import type { Card } from "@/lib/types";
import { BANK_CODES, validateCard } from "@/lib/validate";
import { SignedInBadge } from "./AdminGate";
import { BulkImport } from "./BulkImport";
import { CardEditor } from "./CardEditor";
import { diffCards, download, toJsonText } from "./diff";
import { PublishPanel } from "./PublishPanel";

const DRAFT_KEY = "kredit-admin-draft-v1";
type Tab = "cards" | "import" | "export" | "publish";

export function AdminApp({ bundled }: { bundled: Card[] }) {
  const [base, setBase] = useState<Card[]>(bundled);
  const [cards, setCards] = useState<Card[]>(bundled);
  const [restored, setRestored] = useState(false);
  const [tab, setTab] = useState<Tab>("cards");
  const [editing, setEditing] = useState<{ card: Card | null } | null>(null);
  const [query, setQuery] = useState("");
  const [bank, setBank] = useState("");
  const [flash, setFlash] = useState<string | null>(null);

  // Restore an unpublished working copy from this browser.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw) as { base: Card[]; cards: Card[] };
        if (!Array.isArray(d?.base) || !Array.isArray(d?.cards)) throw new Error("bad draft");
        // Only resume a draft that has real edits; otherwise use the freshly
        // deployed data so a stale copy never shadows newer published cards.
        if (diffCards(d.base, d.cards).count > 0) {
          setBase(d.base);
          setCards(d.cards);
          setFlash("Restored your unpublished changes from this browser");
        }
      }
    } catch {}
    setRestored(true);
  }, []);
  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ base, cards }));
    } catch {}
  }, [base, cards, restored]);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 3500);
    return () => clearTimeout(t);
  }, [flash]);

  const diff = useMemo(() => diffCards(base, cards), [base, cards]);
  const checks = useMemo(() => new Map(cards.map((c) => [c.id, validateCard(c as never)])), [cards]);
  const visible = cards.filter((c) => {
    if (bank && c.bank_name !== bank) return false;
    const q = query.trim().toLowerCase();
    return !q || `${c.card_name} ${c.id} ${c.bank_name}`.toLowerCase().includes(q);
  });

  const update = (next: Card[], msg?: string) => {
    setCards(next);
    if (msg) setFlash(msg);
  };

  const saveCard = (card: Card, originalId: string | null) => {
    if (originalId) update(cards.map((c) => (c.id === originalId ? card : c)), `Saved ${card.card_name}`);
    else update([...cards, card], `Added ${card.card_name}`);
    setEditing(null);
  };

  const duplicate = (c: Card) => {
    let id = `${c.id}-copy`;
    for (let n = 2; cards.some((x) => x.id === id); n++) id = `${c.id}-copy-${n}`;
    const copy = { ...structuredClone(c), id, card_name: `${c.card_name} (copy)`, hidden: true };
    const i = cards.findIndex((x) => x.id === c.id);
    update([...cards.slice(0, i + 1), copy, ...cards.slice(i + 1)], `Duplicated as hidden draft`);
  };

  const status = (c: Card) => {
    const r = checks.get(c.id)!;
    if (r.errors.length) return { Icon: CircleAlert, cls: "text-rose-600", label: `${r.errors.length} error(s)`, tip: r.errors.join("\n") };
    if (r.warnings.length) return { Icon: TriangleAlert, cls: "text-amber-500", label: `${r.warnings.length} warning(s)`, tip: r.warnings.join("\n") };
    return { Icon: CircleCheck, cls: "text-emerald-600", label: "Valid", tip: "" };
  };
  const changeOf = (id: string) =>
    diff.added.includes(id) ? "new" : diff.modified.includes(id) ? "edited" : null;

  const tabs: [Tab, string, number?][] = [
    ["cards", "Cards", cards.length],
    ["import", "Bulk import"],
    ["export", "Export"],
    ["publish", "Publish", diff.count || undefined],
  ];

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <a href="../" className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-lg bg-navy-900 text-white">
              <CreditCard className="size-3.5" aria-hidden />
            </span>
            <span className="font-display font-bold text-navy-900">Bitaqa</span>
            <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-800">Admin</span>
          </a>
          <div className="flex items-center gap-2 text-sm">
            {diff.count > 0 ? (
              <>
                <span className="hidden text-slate-600 sm:inline">
                  <b>{diff.count}</b> unpublished change{diff.count === 1 ? "" : "s"}
                </span>
                <button
                  type="button"
                  className="btn-secondary !py-1.5"
                  aria-label="Discard changes"
                  onClick={() => confirm("Discard all unpublished changes in this browser?") && update(base, "Changes discarded")}
                >
                  <RotateCcw className="size-3.5" aria-hidden /> <span className="hidden sm:inline">Discard</span>
                </button>
                <button type="button" className="btn-emerald !py-1.5" onClick={() => setTab("publish")}>
                  <span className="sm:hidden">Publish ({diff.count})</span>
                  <span className="hidden sm:inline">Review & publish</span>
                </button>
              </>
            ) : (
              <span className="text-slate-500">All changes published</span>
            )}
            <SignedInBadge />
          </div>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 sm:px-6" aria-label="Admin sections">
          {tabs.map(([id, label, n]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-current={tab === id ? "page" : undefined}
              className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold transition ${
                tab === id ? "border-emerald-600 text-navy-900" : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {label}
              {n !== undefined && <span className="ms-1.5 rounded-full bg-slate-100 px-1.5 text-xs tabular-nums text-slate-600">{n}</span>}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {tab === "cards" && (
          <div className="rounded-2xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
              <div className="relative min-w-0 flex-1 basis-56">
                <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
                <input className="input ps-9" placeholder="Search cards" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <select className="input !w-auto" value={bank} onChange={(e) => setBank(e.target.value)} aria-label="Filter by bank">
                <option value="">All banks</option>
                {BANK_CODES.map((b) => (
                  <option key={b} value={b}>
                    {BANKS[b].name}
                  </option>
                ))}
              </select>
              <button type="button" className="btn-primary" onClick={() => setEditing({ card: null })}>
                <Plus className="size-4" aria-hidden /> Add card
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="whitespace-nowrap bg-slate-50 text-start text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="p-3 text-start font-semibold">Card</th>
                    <th className="p-3 text-start font-semibold">Type</th>
                    <th className="p-3 text-end font-semibold">Min salary</th>
                    <th className="p-3 text-end font-semibold">Fee</th>
                    <th className="p-3 text-start font-semibold">Rewards</th>
                    <th className="p-3 text-start font-semibold">Verified</th>
                    <th className="p-3 text-start font-semibold">Status</th>
                    <th className="p-3" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((c) => {
                    const s = status(c);
                    const change = changeOf(c.id);
                    return (
                      <tr key={c.id} className={`border-t border-slate-100 ${c.hidden ? "bg-slate-50/70 text-slate-500" : ""}`}>
                        <td className="min-w-[240px] p-3">
                          <button type="button" className="text-start" onClick={() => setEditing({ card: c })}>
                            <span className="block font-semibold text-navy-900 hover:underline">{c.card_name || c.id}</span>
                            <span className="text-xs text-slate-500">
                              {[BANKS[c.bank_name]?.name ?? c.bank_name ?? "?", [c.network, c.tier].filter(Boolean).join(" ")].filter(Boolean).join(" · ")}
                            </span>
                          </button>
                          <span className="ms-2 inline-flex gap-1 align-middle">
                            {change && (
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${change === "new" ? "bg-emerald-100 text-emerald-800" : "bg-navy-50 text-navy-700"}`}>
                                {change}
                              </span>
                            )}
                            {c.hidden && <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-600">draft</span>}
                          </span>
                        </td>
                        <td className="p-3">{c.is_islamic ? "Islamic" : "Conventional"}</td>
                        <td className="whitespace-nowrap p-3 text-end tabular-nums">{c.min_salary_aed != null ? aed(c.min_salary_aed) : "—"}</td>
                        <td className="whitespace-nowrap p-3 text-end tabular-nums">{c.is_free_for_life ? "Free" : c.annual_fee_aed != null ? aed(c.annual_fee_aed) : "—"}</td>
                        <td className="p-3">{c.reward_type?.join(", ").replace("_", " ")}</td>
                        <td className="whitespace-nowrap p-3 tabular-nums text-slate-500">{c.last_verified ?? "—"}</td>
                        <td className="p-3">
                          <span className={`inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium ${s.cls}`} title={s.tip}>
                            <s.Icon className="size-4" aria-hidden /> {s.label}
                          </span>
                        </td>
                        <td className="p-3">
                          <div className="flex justify-end gap-0.5">
                            <IconBtn label="Edit" onClick={() => setEditing({ card: c })} Icon={Pencil} />
                            <IconBtn label="Duplicate" onClick={() => duplicate(c)} Icon={Copy} />
                            <IconBtn
                              label={c.hidden ? "Show on site" : "Hide from site"}
                              onClick={() => {
                                if (c.hidden && checks.get(c.id)!.errors.length) {
                                  setFlash("Fix this card's errors before showing it");
                                  return;
                                }
                                update(cards.map((x) => (x.id === c.id ? { ...x, hidden: !c.hidden || undefined } : x)));
                              }}
                              Icon={c.hidden ? Eye : EyeOff}
                            />
                            <IconBtn
                              label="Delete"
                              danger
                              onClick={() => confirm(`Delete ${c.card_name}? You can still discard before publishing.`) && update(cards.filter((x) => x.id !== c.id), `Deleted ${c.card_name}`)}
                              Icon={Trash2}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {diff.deleted.map((id) => (
                    <tr key={`del-${id}`} className="border-t border-slate-100 bg-rose-50/50 text-rose-700">
                      <td className="p-3 line-through" colSpan={7}>
                        {base.find((c) => c.id === id)?.card_name ?? id}
                        <span className="ms-2 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase no-underline">deleted</span>
                      </td>
                      <td className="p-3 text-end">
                        <button
                          type="button"
                          className="text-xs font-semibold underline"
                          onClick={() => update([...cards, base.find((c) => c.id === id)!], "Restored")}
                        >
                          Undo
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "import" && (
          <BulkImport
            cards={cards}
            onApply={(next, summary) => {
              update(next, summary);
              setTab("cards");
            }}
          />
        )}

        {tab === "export" && (
          <div className="grid gap-4 sm:grid-cols-3">
            <ExportCard
              title="JSON"
              text="The exact file the site uses (data/cards.json). Use it as a backup, or to feed the CLI import."
              onClick={() => download("cards.json", toJsonText(cards), "application/json")}
            />
            <ExportCard
              title="CSV (Excel / Google Sheets)"
              text="One row per card. Edit in a spreadsheet, then re-import it here to update cards in bulk."
              onClick={() => download("cards.csv", cardsToCsv(cards), "text/csv")}
            />
            <ExportCard
              title="Blank CSV template"
              text={`All ${CSV_COLUMNS.length} columns with one example row. Use " | " to separate list items in a cell.`}
              onClick={() => download("cards-template.csv", cardsToCsv(cards.slice(0, 1)), "text/csv")}
            />
          </div>
        )}

        {tab === "publish" && (
          <PublishPanel
            base={base}
            cards={cards}
            diff={diff}
            onLoaded={(remote) => {
              setBase(remote);
              setCards(remote);
            }}
            onPublished={(published) => {
              setBase(published);
              setCards(published);
            }}
          />
        )}
      </main>

      {editing && (
        <CardEditor
          card={editing.card}
          existingIds={cards.map((c) => c.id)}
          onSave={saveCard}
          onClose={() => setEditing(null)}
        />
      )}

      {flash && (
        <div role="status" className="fixed bottom-5 start-1/2 z-[60] -translate-x-1/2 rounded-full bg-navy-900 px-4 py-2 text-sm font-medium text-white shadow-lg rtl:translate-x-1/2">
          {flash}
        </div>
      )}
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  Icon,
  danger,
}: {
  label: string;
  onClick: () => void;
  Icon: React.ComponentType<{ className?: string }>;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`rounded-lg p-2 transition ${danger ? "text-slate-400 hover:bg-rose-50 hover:text-rose-600" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"}`}
    >
      <Icon className="size-4" />
    </button>
  );
}

function ExportCard({ title, text, onClick }: { title: string; text: string; onClick: () => void }) {
  return (
    <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5">
      <FileSpreadsheet className="size-6 text-navy-700" aria-hidden />
      <h3 className="mt-3 font-display font-bold text-navy-900">{title}</h3>
      <p className="mt-1 flex-1 text-sm text-slate-600">{text}</p>
      <button type="button" className="btn-secondary mt-4" onClick={onClick}>
        <Download className="size-4" aria-hidden /> Download
      </button>
    </div>
  );
}
