"use client";

import { CloudDownload, ExternalLink, KeyRound, Rocket, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { DEFAULT_TARGET, commitFile, fetchRemoteFile, type RepoTarget } from "@/lib/github";
import type { Card } from "@/lib/types";
import { validateCard } from "@/lib/validate";
import { diffCards, rebase, sameCard, toJsonText, type Diff } from "./diff";

const TOKEN_KEY = "kredit-admin-token";
const TARGET_KEY = "kredit-admin-target";

function readStored(key: string): string | null {
  try {
    return sessionStorage.getItem(key) ?? localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function PublishPanel({
  base,
  cards,
  diff,
  onLoaded,
  onPublished,
}: {
  base: Card[];
  cards: Card[];
  diff: Diff;
  onLoaded: (remote: Card[]) => void;
  onPublished: (published: Card[]) => void;
}) {
  const [target, setTarget] = useState<RepoTarget>(DEFAULT_TARGET);
  const [token, setToken] = useState("");
  const [remember, setRemember] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<null | "load" | "publish">(null);
  const [status, setStatus] = useState<{ tone: "ok" | "err"; text: string; links?: [string, string][] } | null>(null);

  useEffect(() => {
    const t = readStored(TOKEN_KEY);
    if (t) {
      setToken(t);
      try {
        setRemember(!!localStorage.getItem(TOKEN_KEY));
      } catch {}
    }
    const tg = readStored(TARGET_KEY);
    if (tg) {
      try {
        setTarget({ ...DEFAULT_TARGET, ...JSON.parse(tg) });
      } catch {}
    }
  }, []);

  const persist = () => {
    try {
      localStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
      if (token) (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);
      localStorage.setItem(TARGET_KEY, JSON.stringify(target));
    } catch {}
  };

  const blocking = cards.filter((c) => !c.hidden && validateCard(c as never).errors.length > 0);
  const defaultMessage = `Update card data: ${diff.added.length} added, ${diff.modified.length} updated, ${diff.deleted.length} removed`;

  async function load() {
    setBusy("load");
    setStatus(null);
    try {
      const remote = await fetchRemoteFile(target, token || null);
      const remoteCards = JSON.parse(remote.text) as Card[];
      if (diff.count && !confirm("Loading from GitHub replaces your unpublished changes in this browser. Continue?")) return;
      onLoaded(remoteCards);
      setStatus({ tone: "ok", text: `Loaded ${remoteCards.length} cards from ${target.owner}/${target.repo}@${target.branch}.` });
    } catch (e) {
      setStatus({ tone: "err", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function publish() {
    setBusy("publish");
    setStatus(null);
    persist();
    try {
      const remote = await fetchRemoteFile(target, token);
      const remoteCards = JSON.parse(remote.text) as Card[];

      // If someone else published since this copy was loaded, re-apply our
      // edits card-by-card on top of theirs; stop on overlapping edits.
      let next = cards;
      let note = "";
      const remoteSame = remoteCards.length === base.length && remoteCards.every((c, i) => sameCard(c, base[i]));
      if (!remoteSame) {
        const { result, conflicts } = rebase(base, cards, remoteCards);
        if (conflicts.length) {
          throw new Error(
            `These cards were also changed on GitHub since you loaded them: ${conflicts.join(", ")}. Export your copy, then Load from GitHub and re-apply.`,
          );
        }
        next = result;
        note = " Merged with newer changes found on GitHub.";
      }

      const res = await commitFile(target, token, toJsonText(next), remote.sha, message.trim() || defaultMessage);
      onPublished(next);
      setMessage("");
      setStatus({
        tone: "ok",
        text: `Published.${note} The site rebuilds automatically in about a minute.`,
        links: [
          ["View commit", res.commitUrl],
          ["Watch deploy", res.actionsUrl],
        ],
      });
    } catch (e) {
      setStatus({ tone: "err", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const tokenUrl = `https://github.com/settings/personal-access-tokens/new`;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-display text-base font-bold text-navy-900">Publish to the live site</h2>
        <p className="mt-1 text-sm text-slate-600">
          Publishing commits <code className="rounded bg-slate-100 px-1">{target.path}</code> to GitHub. That push
          triggers the deploy workflow, which rebuilds the public site.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          {(["owner", "repo", "branch", "path"] as const).map((k) => (
            <label key={k} className="block">
              <span className="mb-1 block text-xs font-medium capitalize text-slate-600">{k}</span>
              <input
                className="input"
                value={target[k]}
                onChange={(e) => setTarget((t) => ({ ...t, [k]: e.target.value }))}
              />
            </label>
          ))}
        </div>

        <label className="mt-3 block">
          <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
            <KeyRound className="size-3.5" aria-hidden />
            GitHub token
          </span>
          <input
            className="input font-mono"
            type="password"
            autoComplete="off"
            placeholder="github_pat_..."
            value={token}
            onChange={(e) => setToken(e.target.value.trim())}
          />
        </label>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-emerald-600" />
            Remember on this device (otherwise kept only for this tab)
          </label>
          <a href={tokenUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-navy-700 hover:underline">
            Create a fine-grained token <ExternalLink className="size-3" aria-hidden />
          </a>
        </div>
        <p className="mt-3 flex gap-2 rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
          <span>
            Use a fine-grained token limited to <b>only this repository</b> with <b>Contents: Read and write</b>, and a
            short expiry. The token stays in this browser and is sent only to api.github.com. Anyone can open this
            page, but nobody can publish without a token.
          </span>
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap gap-2 text-sm">
          <Pill n={diff.added.length} label="added" />
          <Pill n={diff.modified.length} label="updated" />
          <Pill n={diff.deleted.length} label="removed" />
          <Pill n={cards.filter((c) => c.hidden).length} label="hidden drafts (not shown on site)" />
        </div>

        {blocking.length > 0 && (
          <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            {blocking.length} visible card(s) have errors: {blocking.map((c) => c.card_name || c.id).join(", ")}. Fix
            them or mark them as drafts before publishing.
          </p>
        )}

        <label className="mt-4 block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Commit message</span>
          <input className="input" placeholder={defaultMessage} value={message} onChange={(e) => setMessage(e.target.value)} />
        </label>

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="btn-emerald" disabled={!token || !diff.count || blocking.length > 0 || !!busy} onClick={publish}>
            <Rocket className="size-4" aria-hidden />
            {busy === "publish" ? "Publishing…" : `Publish ${diff.count} change${diff.count === 1 ? "" : "s"}`}
          </button>
          <button type="button" className="btn-secondary" disabled={!!busy} onClick={load}>
            <CloudDownload className="size-4" aria-hidden />
            {busy === "load" ? "Loading…" : "Load latest from GitHub"}
          </button>
        </div>

        {status && (
          <div
            role="status"
            className={`mt-4 rounded-xl border p-3 text-sm ${
              status.tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"
            }`}
          >
            {status.text}
            {status.links && (
              <span className="mt-1 flex gap-4">
                {status.links.map(([label, href]) => (
                  <a key={href} href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold underline">
                    {label} <ExternalLink className="size-3" aria-hidden />
                  </a>
                ))}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Pill({ n, label }: { n: number; label: string }) {
  return (
    <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
      <b className="tabular-nums">{n}</b> {label}
    </span>
  );
}
