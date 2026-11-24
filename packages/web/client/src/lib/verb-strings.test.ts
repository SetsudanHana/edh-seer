// @vitest-environment node
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { VERB_VOCAB } from "@edh-seer/tagger";
import { eventVerbPhrase } from "@edh-seer/matcher/sentence";
import { OTHER_PLAYER_SUFFIX } from "@edh-seer/matcher/zones";
import { demandSentence, eventKeyAction, eventKeyClause, eventKeySentence } from "./demand-sentence.js";

/** #1170 PR 2: THE VERB TABLES BECAME ONE RECORD (`@edh-seer/matcher/verbs`), and a refactor of seven
 *  tables must not move a word. TWO SNAPSHOTS, both of every string those tables could produce (every
 *  verb x the key shapes each function reads):
 *  - `verb-strings.before.json`, taken from `main` before the change;
 *  - `verb-strings.after.json`, the record's output, compared EXACTLY, so a new string is pinned too and
 *    cannot drift unseen. Regenerate it with `WRITE_VERB_SNAPSHOT=1` after a deliberate wording change.
 *  A string may differ from `before` only where the old output was a fallback (a de-slugified key, or no
 *  action at all) and the record now names the verb. */
const SNAPSHOT_FILE = new URL("./fixtures/verb-strings.before.json", import.meta.url);
const AFTER_FILE = new URL("./fixtures/verb-strings.after.json", import.meta.url);

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

if (process.env.WRITE_VERB_SNAPSHOT) writeFileSync(AFTER_FILE, JSON.stringify(snapshot(), null, 1) + "\n");

test("every string the record produces is exactly the committed after-snapshot", () => {
  const after: Record<string, string | null> = JSON.parse(readFileSync(AFTER_FILE, "utf8"));
  const now = snapshot();
  expect(Object.keys(now).sort()).toEqual(Object.keys(after).sort());
  const moved = Object.keys(after).filter((k) => after[k] !== now[k]).map((k) => `${k}: ${JSON.stringify(after[k])} -> ${JSON.stringify(now[k])}`);
  expect(moved).toEqual([]);
});

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

/** #1170 PR 2 review. A key that names a class must read as ITS OWN event, and a clause must be a
 *  clause. The first record cut gave `search|land`, `search|creature` and `search|-` one sentence ("a
 *  library being searched"), `gain-life|artifact` "life being gained", and AbilityTable printed
 *  "when a library being searched" (the AK4 defect). A class that is the OBJECT is said as the object
 *  ("a land being searched for"); a class that is a SOURCE has no typed form yet and keeps the key's
 *  words, because a silent merge of two distinct keys is worse than an ugly one. */
/** The trigger verbs and the zone event; `meld` and `copies` are feeder keys that carry no class by design. */
const EVENT_VERBS = [...VERB_VOCAB, "leaves-graveyard"];
const CLASS_SHAPES: [string, string, string][] = [["creature", "-", "-"], ["land", "-", "-"], ["artifact", "-", "-"], ["creature", "goblin", "-"], ["artifact,creature", "-", "t"]];

test("distinct keys never collapse to one sentence or one clause", () => {
  const collapsed: string[] = [];
  for (const v of EVENT_VERBS) {
    for (const [fn, name] of [[eventKeySentence, "sentence"], [eventKeyClause, "clause"]] as const) {
      const seen = new Map<string, string>();
      for (const [t, st, tok] of CLASS_SHAPES) {
        const out = fn(`${v}|${t}|${st}|${tok}`);
        const prior = seen.get(out);
        if (prior !== undefined) collapsed.push(`${name}: ${v}|${t}|${st}|${tok} and ${prior} both read ${JSON.stringify(out)}`);
        seen.set(out, `${t}|${st}|${tok}`);
      }
    }
  }
  expect(collapsed).toEqual([]);
});

/** A clause sits inside a sentence ("when ..."), so an -ing participle phrase is the label form in the
 *  wrong place. The few words that merely end in -ing are not participles. */
const NOT_PARTICIPLES = new Set(["beginning", "anything", "something", "nothing", "everything", "during", "ring"]);
test("a clause is never a participle phrase", () => {
  const bad: string[] = [];
  for (const v of EVENT_VERBS) {
    for (const [t, st, tok] of [...CLASS_SHAPES, ["-", "-", "-"] as [string, string, string], ["-", "-", "n"] as [string, string, string]]) {
      const key = `${v}|${t}|${st}|${tok}`;
      const out = eventKeyClause(key);
      const words: string[] = out.toLowerCase().match(/[a-z']+/g) ?? [];
      if (words.includes("being") || words.some((w) => w.endsWith("ing") && w.length > 4 && !NOT_PARTICIPLES.has(w) && !key.includes(w.replace(/ing$/, "")))) bad.push(`${key} -> ${out}`);
    }
  }
  expect(bad).toEqual([]);
});

test("a searched-for class is the object of the search", () => {
  expect(eventKeyClause("search|land|-|-")).toBe("a land is searched for");
  expect(eventKeySentence("search|land|-|-")).toBe("a land being searched for");
  expect(eventKeyClause("search|-|-|-")).toBe("a library is searched");
  expect(demandSentence("search:type:land")).toBe("a land being searched for");
});
