/** Fetch the Comprehensive Rules as plain text and cache it. Free — no key, no model, no spend.
 *
 *  The CR is the only authoritative source for the closed lists the GAME has, as opposed to the ones
 *  our corpus happens to contain. Precedent: rule 122.1b fixed the keyword-counter dictionary, which
 *  had an invented `ward` counter and was missing decayed/exalted/shadow.
 *
 *  Plain .txt, never the PDF: the text file is line-numbered and regular, so a rule list is a grep.
 *  Cached to a gitignored path for the same reason `.cs-cache/` is — it is a large third-party file
 *  that changes a few times a year, and re-downloading it on every run is rude and slow.
 *
 *    tsx src/bin/fetch-comp-rules.ts           # fetch if absent, else report the cached version
 *    tsx src/bin/fetch-comp-rules.ts --check   # non-zero exit if a newer version is published
 *    tsx src/bin/fetch-comp-rules.ts --force   # re-fetch regardless */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const CACHE_DIR = ".cr-cache";
const RULES_PAGE = "https://magic.wizards.com/en/rules";
const CHECK = process.argv.includes("--check");
const FORCE = process.argv.includes("--force");

/** The rules page links the current dated .txt directly. Read the LINK rather than guessing a date:
 *  the URL carries the effective date and WotC does not publish a "latest" alias. */
async function currentUrl(): Promise<string> {
  const html = await (await fetch(RULES_PAGE)).text();
  // media.wizards.com/<year>/downloads/MagicCompRules%20<YYYYMMDD>.txt
  const m = html.match(/https?:\/\/media\.wizards\.com\/[^"']*MagicCompRules[^"']*\.txt/i);
  if (!m) throw new Error(`no MagicCompRules .txt link found on ${RULES_PAGE}`);
  return m[0].replace(/&amp;/g, "&");
}

const url = await currentUrl();
const version = url.match(/(\d{8})/)?.[1] ?? "unknown";
const path = `${CACHE_DIR}/MagicCompRules-${version}.txt`;

if (existsSync(path) && !FORCE) {
  const size = readFileSync(path, "utf8").length;
  console.log(`cached: ${path} (${(size / 1024).toFixed(0)} KB), current published version is ${version}`);
  process.exit(0);
}

if (CHECK) {
  console.log(`DRIFT: published version ${version} is not cached. Run without --check to fetch.`);
  process.exit(1);
}

mkdirSync(CACHE_DIR, { recursive: true });
const res = await fetch(url);
if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
// The CR ships as UTF-8 with a BOM; strip it so a `^\d` anchor works on the first rule line.
const text = (await res.text()).replace(/^﻿/, "");
writeFileSync(path, text);
console.log(`fetched ${url}\n  -> ${path} (${(text.length / 1024).toFixed(0)} KB)`);
