/** Writes data/cards.csv (spreadsheet-friendly copy of data/cards.json). */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { cardsToCsv } from "../lib/csv.ts";

const dir = resolve(import.meta.dirname, "../data");
const cards = JSON.parse(readFileSync(`${dir}/cards.json`, "utf8"));
writeFileSync(`${dir}/cards.csv`, cardsToCsv(cards));
console.log(`Wrote ${dir}/cards.csv (${cards.length} cards)`);
