// @vitest-environment node
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { VERB_VOCAB } from "@edh-seer/tagger";
import { eventVerbPhrase } from "@edh-seer/matcher/sentence";
import { OTHER_PLAYER_SUFFIX } from "@edh-seer/matcher/zones";
import { demandSentence, eventKeyAction, eventKeyClause, eventKeySentence } from "./demand-sentence.js";

/** #1170 PR 2: THE VERB TABLES BECAME ONE RECORD (`@edh-seer/matcher/verbs`), and a refactor of seven
 *  tables must not move a word. This snapshot is every string those tables could produce, taken from
 *  `main` before the change: every verb x the key shapes each function reads. The test compares the
 *  new output to it. A string may differ only where the old output was a fallback (a de-slugified
 *  key, or no action at all) and the record now names the verb; each such difference is listed in
 *  `CHANGED` below, so a silent move fails and a deliberate one is reviewable. */
const SNAPSHOT_FILE = new URL("./fixtures/verb-strings.before.json", import.meta.url);

const VERBS = [...VERB_VOCAB, "leaves-graveyard", "fills", "meld", "counts", "fodder", "copies", "applies:pump", "some-future-verb"];
const CENSUS_SUBJECTS = ["*", "type:creature", "subtype:wizard", "type:artifact+creature"];
const SUFFIXES = ["", " (narrowed)", OTHER_PLAYER_SUFFIX];
const KEY_SHAPES: [string, string, string][] = [["-", "-", "-"], ["creature", "-", "-"], ["creature", "goblin", "-"], ["-", "-", "n"], ["artifact,creature", "-", "t"]];
const REASON_SUBJECTS = ["creature", "any", "you", "opp", "artifact"];

export function snapshot(): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const v of VERBS) {
    for (const s of REASON_SUBJECTS) out[`phrase|${v}:${s}`] = eventVerbPhrase(`${v}:${s}`);
    for (const s of CENSUS_SUBJECTS) for (const x of SUFFIXES) out[`demand|${v}:${s}${x}`] = demandSentence(`${v}:${s}${x}`);
    for (const [t, st, tok] of KEY_SHAPES) {
      const key = `${v}|${t}|${st}|${tok}`;
      out[`sentence|${key}`] = eventKeySentence(key);
      out[`sentence-self|${key}`] = eventKeySentence(key, "this card");
      out[`clause|${key}`] = eventKeyClause(key);
      out[`clause-self|${key}`] = eventKeyClause(key, "this card");
      out[`action|${key}`] = eventKeyAction(key) ?? null;
    }
  }
  return out;
}

if (process.env.WRITE_VERB_SNAPSHOT) writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot(), null, 1) + "\n");

/** WHERE THE OLD OUTPUT WAS A FALLBACK, the record may now name the verb. Each function's fallback is
 *  recognisable from the old snapshot itself: a de-slugified key (`demand`, `sentence`), the label
 *  where a clause had none (`clause` == `sentence`), no action at all (`action` null), the naive
 *  plural (`phrase`). Anything else the old tables HAD an entry for, and it must not move. */
function wasFallback(k: string, before: Record<string, string | null>): boolean {
  const [fn, key] = [k.slice(0, k.indexOf("|")), k.slice(k.indexOf("|") + 1)];
  const old = before[k];
  switch (fn) {
    case "demand": return old === key.replace(/[:-]/g, " ");
    case "sentence": case "sentence-self": return old === key.replace(/[|:-]/g, " ");
    case "clause": return old === before[`sentence|${key}`];
    case "clause-self": return old === before[`sentence-self|${key}`];
    case "action": case "action-self": return old === null;
    case "phrase": return old === `${key.split(":")[0]!.replace(/-/g, " ")}s`;
    default: return false;
  }
}

test("every string the old verb tables produced is unchanged; only a former fallback may read better", () => {
  const before: Record<string, string | null> = JSON.parse(readFileSync(SNAPSHOT_FILE, "utf8"));
  const after = snapshot();
  const moved: string[] = [];
  let filled = 0;
  for (const k of Object.keys(before)) {
    // `eventLabel` is gone: its only caller was the card chip, which now reads `tagName`.
    if (k.startsWith("label|") || before[k] === after[k]) continue;
    if (wasFallback(k, before)) { filled++; continue; }
    moved.push(`${k}: ${JSON.stringify(before[k])} -> ${JSON.stringify(after[k])}`);
  }
  expect(moved).toEqual([]);
  // The fills are real, not zero (the 34 / 34 / 51 verbs the old tables lacked).
  expect(filled).toBeGreaterThan(0);
  if (process.env.WRITE_VERB_DIFF) writeFileSync(process.env.WRITE_VERB_DIFF, JSON.stringify(Object.keys(before).filter((k) => !k.startsWith("label|") && before[k] !== after[k]).map((k) => [k, before[k], after[k]]), null, 1));
});
