/** THE COMPREHENSIVE RULES, ON DISK, BECAUSE A RULE NUMBER RECALLED FROM MEMORY IS A GUESS.
 *
 *  The rules text is the ONLY authority for the vocabularies this engine closes that card data does
 *  not enumerate -- counters, zones, timing concepts. MTGJSON covers types/subtypes/keywords and
 *  Scryfall covers printed characteristics; neither says what a keyword counter IS. The repo has
 *  cited `CR N` in comments since 2026-08-06 and carries two ledgers that ratchet those citations
 *  (`rules-invariants.test.ts`, in tagger/src/derive and matcher/src), and until now there was no
 *  copy to check a number AGAINST: on 2026-09-20 four citations were written from memory in one
 *  comment and at least one was wrong -- the ledger already assigned 702.62 to changeling.
 *
 *  GITIGNORED ON PURPOSE. It is Wizards' text, ~1MB, and it changes with every set; the repo is
 *  public. `rules/` is in `.gitignore`, so a fresh clone has no copy and this is how you get one.
 *
 *  THERE IS NO STABLE URL. `MagicCompRules current.txt` is a 404 -- the filename carries the rules
 *  revision date (`MagicCompRules 20260925.txt`), which WotC posts slightly ahead of a set release.
 *  So the page is scraped for the link rather than the date being guessed.
 *
 *  THE .txt AND NOT THE .pdf: same content, no extraction step, one paragraph per rule.
 *
 *    npx tsx research/rules/fetch-comprehensive-rules.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const PAGE = "https://magic.wizards.com/en/rules";
const OUT = "rules/MagicCompRules.txt";

const page = await fetch(PAGE);
if (!page.ok) throw new Error(`${PAGE} answered ${page.status}`);
// The filename contains a literal space, so the character class stops at quotes and angle brackets
// rather than at whitespace.
const link = [...(await page.text()).matchAll(/https:\/\/media\.wizards\.com\/\d{4}\/downloads\/MagicCompRules[^"'<>]*\.txt/gi)]
  .map((m) => m[0])
  .sort()
  .at(-1);
if (!link) throw new Error(`no MagicCompRules .txt link on ${PAGE} -- the page layout changed`);

const res = await fetch(encodeURI(link));
if (!res.ok) throw new Error(`${link} answered ${res.status}`);
// The file is served as latin1-ish with a BOM on some revisions; `text()` decodes UTF-8, which is
// what every reader here wants, and the BOM is stripped so a `^` anchored rule match works on line 1.
const text = (await res.text()).replace(/^﻿/, "");

// A SANITY CHECK, NOT A SCHEMA. A truncated download or an error page would otherwise be written
// over a good copy. Counted on the line OPENER and not on a trailing dot: a lettered sub-rule
// ("306.5b A planeswalker has...") prints no dot after the letter, and requiring one counts 1,175
// where the file holds 3,165 (measured on revision 20260925).
const rules = [...text.matchAll(/^\d{3}\.\d+[a-z]?\b/gm)].length;
if (rules < 2000) throw new Error(`only ${rules} numbered rules in ${link} -- that is not the rules text`);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, text);
console.log(`${link.split("/").pop()} -> ${OUT}`);
console.log(`${rules} numbered rules, ${(text.length / 1024).toFixed(0)} KB`);
