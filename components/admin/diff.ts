import type { Card } from "@/lib/types";

export const stableStringify = (v: unknown) =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
      : x,
  );

export const sameCard = (a: Card | undefined, b: Card | undefined) => stableStringify(a) === stableStringify(b);

export interface Diff {
  added: string[];
  modified: string[];
  deleted: string[];
  count: number;
}

export function diffCards(base: Card[], next: Card[]): Diff {
  const b = new Map(base.map((c) => [c.id, c]));
  const n = new Map(next.map((c) => [c.id, c]));
  const added = next.filter((c) => !b.has(c.id)).map((c) => c.id);
  const modified = next.filter((c) => b.has(c.id) && !sameCard(b.get(c.id), c)).map((c) => c.id);
  const deleted = base.filter((c) => !n.has(c.id)).map((c) => c.id);
  return { added, modified, deleted, count: added.length + modified.length + deleted.length };
}

/**
 * Re-apply local edits (local vs base) on top of a newer remote dataset.
 * Cards changed both locally and remotely are conflicts and are not merged.
 */
export function rebase(base: Card[], local: Card[], remote: Card[]) {
  const d = diffCards(base, local);
  const baseMap = new Map(base.map((c) => [c.id, c]));
  const remoteMap = new Map(remote.map((c) => [c.id, c]));
  const localMap = new Map(local.map((c) => [c.id, c]));

  const touched = [...d.modified, ...d.deleted];
  const conflicts = touched.filter((id) => !sameCard(baseMap.get(id), remoteMap.get(id)));
  conflicts.push(...d.added.filter((id) => remoteMap.has(id) && !sameCard(remoteMap.get(id), localMap.get(id))));

  const result = remote
    .filter((c) => !d.deleted.includes(c.id))
    .map((c) => (d.modified.includes(c.id) ? localMap.get(c.id)! : c));
  for (const id of d.added) if (!remoteMap.has(id)) result.push(localMap.get(id)!);
  return { result, conflicts };
}

export function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const toJsonText = (cards: Card[]) => JSON.stringify(cards, null, 2) + "\n";
