import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { VERBS, TRIGGERS, ZONES } from "../normalize-prompt.js";
import { EFFECT_KINDS, SCALING_BASES, VERB_VOCAB } from "../schema.js";
import { OUT, docAbove, members, renderSchemaDoc, sources, stripComments } from "./gen-schema-docs.js";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** THE STALENESS GATE, and the reason this file exists. `docs/HOW-IT-WORKS.md` carried four wrong
 *  version constants for a month because prose is not gated. This one is. */
test("the checked-in schema reference matches what the generator produces", () => {
  expect(readFileSync(join(ROOT, OUT), "utf8")).toBe(renderSchemaDoc(sources(ROOT)));
});

/** THE SCANNER GATE, which the comparison above cannot give. Two identical files prove only that
 *  nobody regenerated since the last run -- if the scanner started dropping half of `TRIGGERS`,
 *  the next person to regenerate would bank the loss and the comparison would go green on it.
 *
 *  So the counts are checked against the lists IMPORTED at runtime, which is the one reading that
 *  cannot be wrong. It has already caught a real defect: scanning quoted strings without stripping
 *  comments first pulled `instead remove all damage marked on it and its controller TAPS IT` into
 *  the verb list and 14 fragments of English into the triggers, reading 100 and 144 where the
 *  lists hold 95 and 117. */
test("every generated list holds exactly the members the code defines", () => {
  const src = sources(ROOT);
  const schema = src["packages/tagger/src/schema.ts"]!;
  const prompt = src["packages/tagger/src/normalize-prompt.ts"]!;
  const scanned = (text: string, name: string): string[] => members(text, name).map((m) => m.name);

  expect(scanned(prompt, "VERBS")).toEqual([...VERBS]);
  expect(scanned(prompt, "TRIGGERS")).toEqual([...TRIGGERS]);
  expect(scanned(prompt, "ZONES")).toEqual([...ZONES]);
  expect(scanned(schema, "VERB_VOCAB")).toEqual([...VERB_VOCAB]);
  expect(scanned(schema, "EFFECT_KINDS")).toEqual([...EFFECT_KINDS]);
  expect(scanned(schema, "SCALING_BASES")).toEqual([...SCALING_BASES]);
});

/** A SECTION THAT COMES BACK EMPTY THROWS rather than rendering a blank table, because a blank table
 *  in a generated file is indistinguishable from a schema that genuinely has no fields. */
test("a missing symbol is an error, not an empty section", () => {
  expect(() => members("export const OTHER = [];\n", "VERBS")).toThrow(/no VERBS/);
  expect(() => members('export const VERBS = [\n];\n', "VERBS")).toThrow(/came back empty/);
});

test("comments cannot be read as members", () => {
  const src = [
    'export const VERBS = ["destroy",',
    '  // amass (Orcish Bowmasters) and "turn-face-up" each had a card stuck behind them',
    '  "amass",',
    '  /* "exile" is not a member here */',
    '  "connive"];',
  ];
  expect(stripComments(src).join("\n")).not.toContain("Bowmasters");
  expect(members(src.join("\n"), "VERBS").map((m) => m.name)).toEqual(["destroy", "amass", "connive"]);
});

/** Both interruptions between a doc comment and the thing it documents occur in this repo:
 *  `DERIVE_VERSION` keeps a `//` changelog below its JSDoc, and `TRIGGER_VOCAB_VERSION` keeps a
 *  plain `/* *\/` note about a repair. */
test("the doc comment is found past a changelog and past a plain note", () => {
  const changelog = ["/** Bump when derivation semantics change.", " *", " *  Free to bump. */", "// 114: top-manipulation retired", "export const DERIVE_VERSION = 114;"];
  expect(docAbove(changelog, 4)).toBe("Bump when derivation semantics change.");

  const note = ["/** The version at which TRIGGERS last changed. */", "/*  LOWERED 14 -> 13, which reads backwards. */", "export const TRIGGER_VOCAB_VERSION = 17;"];
  expect(docAbove(note, 2)).toBe("The version at which TRIGGERS last changed.");

  expect(docAbove(["export const X = 1;"], 0)).toBe("");
});

/** FIRST PARAGRAPH ONLY. The fields in `schema.ts` carry twenty lines each; the reference exists to
 *  be readable, and the argument stays in the source it is linked to. */
test("only the first paragraph of a doc comment reaches the page", () => {
  const lines = ["/** The summary line.", " *", " *  The measurement, the witness card, and the defect. */", "export const X = 1;"];
  expect(docAbove(lines, 3)).toBe("The summary line.");
});

/** EVERY RELATIVE LINK IN THE DOCS RESOLVES. A four-directory doc set rots into dead links faster
 *  than it rots into wrong prose, and a dead link is the one kind of staleness a reader cannot work
 *  around. Anchors are not checked -- only that the file on the other end exists. */
test("no doc links to a file that is not there", () => {
  // The front door is included, not just `docs/`: the README and CONTRIBUTING now carry most of the
  // links a first-time reader follows, and a dead one there is the worst place to have it.
  const docs = [
    "README.md", "CONTRIBUTING.md", "SECURITY.md",
    "docs/README.md", "docs/HOW-IT-WORKS.md", "docs/RUNBOOK.md", "docs/reference/SCHEMA.md",
    "docs/pipeline/1-segment.md", "docs/pipeline/2-normalize.md",
    "docs/pipeline/3-derive.md", "docs/pipeline/4-match.md",
  ];
  const broken: string[] = [];
  for (const doc of docs) {
    const text = readFileSync(join(ROOT, doc), "utf8");
    for (const m of text.matchAll(/\]\(([^)#][^)]*)\)/g)) {
      const target = m[1]!.split("#")[0]!;
      if (target === "" || /^https?:/.test(target)) continue;
      if (!existsSync(join(ROOT, dirname(doc), target))) broken.push(`${doc} -> ${target}`);
    }
  }
  expect(broken).toEqual([]);
});
