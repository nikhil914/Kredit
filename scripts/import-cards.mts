/**
 * Bulk-import cards into data/cards.json from JSON (scraper output) or CSV.
 *
 *   npm run import -- <file.json|file.csv> [--replace] [--drafts] [--dry-run]
 *
 *   --replace  the import becomes the whole dataset (default: merge by id)
 *   --drafts   keep invalid rows as hidden drafts instead of skipping them
 *   --dry-run  print the report, write nothing
 *
 * Exits 1 when any row is invalid (unless --drafts), so it can gate CI.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { extractCardArray, planImport } from "../lib/validate.ts";
import { parseCsv } from "../lib/csv.ts";
import type { Card } from "../lib/types.ts";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const flag = (f: string) => args.includes(f);

if (!file) {
  console.error("Usage: npm run import -- <file.json|file.csv> [--replace] [--drafts] [--dry-run]");
  process.exit(2);
}

const dataPath = resolve(import.meta.dirname, "../data/cards.json");
const existing = JSON.parse(readFileSync(dataPath, "utf8")) as Card[];
const text = readFileSync(resolve(file), "utf8");
const rows = extname(file).toLowerCase() === ".csv" ? parseCsv(text) : extractCardArray(JSON.parse(text));

const plan = planImport(existing, rows, flag("--replace") ? "replace" : "merge", flag("--drafts"));

console.log(`\nImport: ${file} (${rows.length} rows, mode ${flag("--replace") ? "replace" : "merge"})`);
console.log(`  + added      ${plan.added.length}`);
console.log(`  ~ updated    ${plan.updated.length}`);
console.log(`  = unchanged  ${plan.unchanged.length}`);
console.log(`  x invalid    ${plan.invalid.length}${flag("--drafts") ? " (kept as hidden drafts)" : " (skipped)"}`);
for (const u of plan.updated) console.log(`    ~ ${u.card.id}: ${u.changed.join(", ")}`);
for (const bad of plan.invalid) console.log(`    x row ${bad.row} ${bad.name}\n        - ${bad.errors.join("\n        - ")}`);
for (const w of plan.warnings) console.log(`    ! ${w.id}: ${w.warnings.join("; ")}`);
console.log(`  -> dataset will have ${plan.result.length} cards\n`);

if (flag("--dry-run")) process.exit(plan.invalid.length && !flag("--drafts") ? 1 : 0);

writeFileSync(dataPath, JSON.stringify(plan.result, null, 2) + "\n");
console.log(`Wrote ${dataPath}`);
process.exit(plan.invalid.length && !flag("--drafts") ? 1 : 0);
