/** THE SCHEMA REFERENCE, GENERATED FROM THE SOURCE THAT DEFINES IT.
 *
 *  `docs/HOW-IT-WORKS.md` quoted four version constants and a panel figure. Checked on 2026-09-08,
 *  four of the six numbers were wrong -- `NORMALIZE_VERSION` read 14 against 17, `DERIVE_VERSION` 85
 *  against 114 -- and nothing failed, because prose is not gated. A hand-written reference listing
 *  95 verbs and 117 triggers would rot the same way and worse: nobody notices WHICH member went
 *  missing.
 *
 *  So the enumerable half of the documentation is generated, and `gen-schema-docs.test.ts` asserts
 *  the checked-in file still matches what this produces. Adding a verb already trips five gates
 *  across four packages; this makes the documentation the sixth rather than the artifact nobody
 *  remembers.
 *
 *  CEILING: a comment-and-brace SCANNER, not a parser. TypeScript 7 dropped the JS compiler API
 *  (`ts.createSourceFile` is gone; the package exposes an `unstable/ast` entry with no parse
 *  function), so an AST walk would mean adding a second TypeScript or depending on an entry point
 *  that is explicitly unstable. The scanner is enough because it reads four files, every one of
 *  them this repo's own consistently formatted source, and every section asserts it found something
 *  -- an empty table throws here rather than being banked by whoever regenerates next. Upgrade to
 *  the compiler API when TS exposes a stable one.
 *
 *  Run: npx tsx packages/tagger/src/bin/gen-schema-docs.ts */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const SCHEMA = "packages/tagger/src/schema.ts";
const PROMPT = "packages/tagger/src/normalize-prompt.ts";
const GATE = "packages/tagger/src/validate-clauses.ts";
const DERIVE = "packages/tagger/src/derive/derive.ts";
export const OUT = "docs/reference/SCHEMA.md";

/** A LINK TO THE FILE, NEVER TO A LINE. A line number would be correct -- this file is generated, so
 *  it cannot drift -- and it would also mean that ANY edit to `schema.ts` shifts every anchor below
 *  it and fails the gate until someone regenerates. The gate should fire when the SCHEMA changes,
 *  not when a comment above it grows a sentence. */
const link = (file: string, symbol: string): string => `[\`${symbol}\`](../../${file})`;

/** A table cell may not contain a raw pipe, and `string | string[]` is a type this schema uses.
 *
 *  THE BACKSLASH GOES FIRST. Escaping the pipe alone means a value already ending in a backslash
 *  produces `\\|`, which is an escaped BACKSLASH followed by a live pipe -- the cell breaks on the
 *  one input that was trying to be literal. No type in the schema carries one today; the order
 *  costs nothing and the reverse is a defect waiting for the first field that does. */
const cell = (s: string): string => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");

/** THE FIRST PARAGRAPH OF THE DOC COMMENT ABOVE A LINE, as one line of text.
 *
 *  First paragraph only, deliberately. `schema.ts` carries the best prose in the repo -- 20 lines a
 *  field, with the witness card and the measurement that put the field there -- and copying all of
 *  it makes a reference nobody reads. The link is how a reader reaches the argument, and the
 *  argument stays in the code, where it is maintained.
 *
 *  Walks up past blank lines and past PLAIN block comments: `TRIGGER_VOCAB_VERSION` carries a `/* *\/`
 *  note about a repair between its JSDoc and its declaration, and the JSDoc is the documentation. */
export function docAbove(lines: string[], index: number): string {
  let end = index - 1;
  for (;;) {
    // Past blank lines, and past `//` notes: `DERIVE_VERSION` keeps a changelog of the last few
    // bumps between its JSDoc and its declaration.
    while (end >= 0 && (lines[end]!.trim() === "" || lines[end]!.trim().startsWith("//"))) end--;
    if (end < 0 || !lines[end]!.trim().endsWith("*/")) return "";
    let start = end;
    while (start >= 0 && !/^\s*\/\*/.test(lines[start]!)) start--;
    if (start < 0) return "";
    // A PLAIN `/* */` NOTE IS NOT DOCUMENTATION. `TRIGGER_VOCAB_VERSION` carries one about a repair
    // between its JSDoc and its declaration, and the JSDoc above it is what documents the constant.
    if (!lines[start]!.trim().startsWith("/**")) { end = start - 1; continue; }
    const body: string[] = [];
    for (let j = start; j <= end; j++) {
      const text = lines[j]!.replace(/^\s*\/\*\*/, "").replace(/\*\/\s*$/, "").replace(/^\s*\*\s?/, "").trim();
      if (text === "" && body.length > 0) break;   // a blank line ends the first paragraph
      if (text !== "") body.push(text);
    }
    return body.join(" ").replace(/\s+/g, " ").trim();
  }
}

/** THE SOURCE WITH ITS COMMENTS BLANKED, line for line, so a member scan cannot read prose.
 *
 *  This is not fastidiousness. `VERBS` carries a comment naming the cards that forced three of its
 *  members, and `TRIGGERS` carries several; scanning quoted strings without this pulled
 *  `instead remove all damage marked on it and its controller TAPS IT` into the verb list and 14
 *  fragments of English into the trigger list, including half a sentence about Mirkwood Bats --
 *  reading 100 verbs and 144 triggers where the lists hold 95 and 117.
 *
 *  Line-for-line so the indices still address the ORIGINAL lines, which is what `docAbove` reads. */
export function stripComments(lines: string[]): string[] {
  let inBlock = false;
  return lines.map((line) => {
    let out = "", i = 0;
    while (i < line.length) {
      if (inBlock) {
        const end = line.indexOf("*/", i);
        if (end < 0) return out;
        inBlock = false; i = end + 2; continue;
      }
      if (line.startsWith("//", i)) return out;
      if (line.startsWith("/*", i)) { inBlock = true; i += 2; continue; }
      out += line[i]; i++;
    }
    return out;
  });
}

/** `export const NAME = <literal>;` -- the version constants, and nothing else. */
export function constValue(src: string, name: string): { value: string; doc: string } {
  const lines = src.split("\n");
  const i = lines.findIndex((l) => l.startsWith(`export const ${name} = `));
  if (i < 0) throw new Error(`gen-schema-docs: no const ${name}`);
  return { value: lines[i]!.replace(`export const ${name} = `, "").replace(/;.*$/, "").trim(), doc: docAbove(lines, i) };
}

/** THE MEMBERS OF A CLOSED LIST, in source order, each with the doc comment above it if it has one.
 *  Serves both shapes the schema uses: `export const X = [...]` and `export type X = | "a" | "b"`. */
export function members(src: string, name: string): { name: string; doc: string }[] {
  const lines = src.split("\n");
  const code = stripComments(lines);
  const start = code.findIndex((l) => l.startsWith(`export const ${name}`) || l.startsWith(`export type ${name} =`));
  if (start < 0) throw new Error(`gen-schema-docs: no ${name}`);
  const out: { name: string; doc: string }[] = [];
  for (let i = start; i < code.length; i++) {
    const line = code[i]!;
    if (i > start && /^export /.test(line)) break;
    for (const m of line.matchAll(/"([^"]+)"/g)) {
      // The doc belongs to the member only when the member is alone on its line; a packed line
      // ("destroy", "exile", "sacrifice", ...) shares one comment or none.
      const alone = line.trim().replace(/^\|\s*/, "").replace(/[,;]$/, "") === `"${m[1]}"`;
      out.push({ name: m[1]!, doc: alone ? docAbove(lines, i) : "" });
    }
    if (i > start && /(\] as const;|\];|";)\s*$/.test(line)) break;
  }
  if (out.length === 0) throw new Error(`gen-schema-docs: ${name} came back empty`);
  return out;
}

/** `export const X: Readonly<Record<string, Y>> = { a: "b", ... }` -- the alias maps. */
export function aliasPairs(src: string, name: string): [string, string][] {
  const code = stripComments(src.split("\n"));
  const start = code.findIndex((l) => l.startsWith(`export const ${name}`));
  if (start < 0) throw new Error(`gen-schema-docs: no ${name}`);
  const out: [string, string][] = [];
  for (let i = start; i < code.length; i++) {
    if (i > start && code[i]!.startsWith("}")) break;
    for (const m of code[i]!.matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g)) out.push([m[1]!, m[2]!]);
  }
  if (out.length === 0) throw new Error(`gen-schema-docs: ${name} came back empty`);
  return out;
}

/** THE FIELDS OF AN INTERFACE: name, whether it is optional, its type, and its first doc paragraph.
 *  Nested object literals are skipped rather than flattened -- the schema has few and they read
 *  better in the source than as a table row with a brace in it. */
export function fields(src: string, name: string): { name: string; optional: boolean; type: string; doc: string }[] {
  const lines = src.split("\n");
  const code = stripComments(lines);
  const start = code.findIndex((l) => l.startsWith(`export interface ${name} {`));
  if (start < 0) throw new Error(`gen-schema-docs: no interface ${name}`);
  const out: { name: string; optional: boolean; type: string; doc: string }[] = [];
  for (let i = start + 1; i < code.length && !code[i]!.startsWith("}"); i++) {
    const m = /^ {2}(\w+)(\??): (.+);$/.exec(code[i]!);
    if (m) out.push({ name: m[1]!, optional: m[2] === "?", type: m[3]!, doc: docAbove(lines, i) });
  }
  if (out.length === 0) throw new Error(`gen-schema-docs: interface ${name} came back empty`);
  return out;
}

function fieldTable(src: string, file: string, name: string): string {
  const rows = fields(src, name).map((f) =>
    `| \`${f.name}\` | \`${cell(f.type)}\` | ${f.optional ? "optional" : "**required**"} | ${cell(f.doc)} |`);
  return `### ${name}\n\nDefined in ${link(file, name)}.\n\n`
    + `| field | type | | what it carries |\n|---|---|---|---|\n${rows.join("\n")}\n`;
}

function listSection(src: string, file: string, name: string, blurb: string): string {
  const rows = members(src, name);
  const documented = rows.filter((r) => r.doc !== "");
  const bare = rows.filter((r) => r.doc === "").map((r) => `\`${r.name}\``).join(", ");
  let out = `### ${name} — ${rows.length} members\n\n${blurb} Defined in ${link(file, name)}.\n\n`;
  if (bare !== "") out += `${bare}\n\n`;
  if (documented.length > 0) {
    out += `| member | why it exists |\n|---|---|\n`
      + documented.map((r) => `| \`${r.name}\` | ${cell(r.doc)} |`).join("\n") + "\n";
  }
  return out;
}

export function renderSchemaDoc(src: Record<string, string>): string {
  const schema = src[SCHEMA]!, prompt = src[PROMPT]!, gate = src[GATE]!, derive = src[DERIVE]!;

  const versions: [string, string, string][] = [
    ["NORMALIZE_VERSION", PROMPT, "prompt"],
    ["NORMALIZE_MIN_COMPATIBLE", PROMPT, "prompt"],
    ["VOCAB_VERSION", PROMPT, "prompt"],
    ["TRIGGER_VOCAB_VERSION", PROMPT, "prompt"],
    ["DERIVE_VERSION", DERIVE, "derive"],
  ];
  const versionRows = versions.map(([name, file]) => {
    const { value, doc } = constValue(file === DERIVE ? derive : file === SCHEMA ? schema : prompt, name);
    return `| \`${name}\` | **${value}** | ${cell(doc)} |`;
  });

  return `# Schema reference

<!-- GENERATED FILE -- do not edit by hand.
     Source: packages/tagger/src/bin/gen-schema-docs.ts
     Regenerate: npx tsx packages/tagger/src/bin/gen-schema-docs.ts
     A test compares this file against the generator's output, so an edit here fails the build. -->

Every list, constant and field on this page is read out of the source that defines it. The prose
pages under [\`docs/pipeline/\`](../pipeline/) explain what the stages do; this one says exactly what
they may say.

Each entry carries the **first paragraph** of its doc comment. The full argument — the witness card,
the measurement, the defect that put the field there — stays in the source, which is linked.

---

## Version constants

What each one costs to bump is the single most expensive thing to get wrong in this repo:
one of these re-buys the corpus and the rest are free.

| constant | value | what it is |
|---|---|---|
${versionRows.join("\n")}

See [\`docs/RUNBOOK.md\`](../RUNBOOK.md) for the procedure behind each bump.

---

## The normalization vocabulary

These are the words the model is allowed to answer with. An answer using anything else is **refused
and not persisted** — the card re-queues rather than banking a guess. They are sized against what the
game can express (the Comprehensive Rules), not against what the current decks happen to play,
because normalization is a one-way ratchet: nobody re-runs 36,000 cards to add a word.

${listSection(prompt, PROMPT, "VERBS", "The action a clause performs.")}
${listSection(prompt, PROMPT, "TRIGGERS", "The event a triggered ability watches for.")}
${listSection(prompt, PROMPT, "ZONES", "Where an action moves something from or to.")}

---

## The engine vocabulary

Derivation maps the model's words onto these. The two lists are **not** the same and are not meant to
be: the clause vocabulary describes what a sentence says, the engine vocabulary describes what the
matcher can join on.

${listSection(schema, SCHEMA, "VERB_VOCAB", "The events a card can supply or watch for.")}
${listSection(schema, SCHEMA, "EFFECT_KINDS", "What an ability DOES, once its trigger is satisfied.")}
${listSection(schema, SCHEMA, "SCALING_BASES", "What an amount scales with, when it is not a number.")}

### Aliases

Answers that mean an existing member are folded onto it rather than refused.

| map | folds |
|---|---|
${[["VERB_ALIASES", schema, SCHEMA], ["EFFECT_ALIASES", schema, SCHEMA], ["SCALING_ALIASES", schema, SCHEMA]]
    .map(([name, text, file]) => `| ${link(file as string, name as string)} | `
      + aliasPairs(text as string, name as string).map(([a, b]) => `\`${a}\`→\`${b}\``).join(", ") + " |").join("\n")}

---

## Types

${fieldTable(schema, SCHEMA, "SubjectFilter")}
${fieldTable(schema, SCHEMA, "StatPredicate")}
${fieldTable(schema, SCHEMA, "GameEvent")}
${fieldTable(schema, SCHEMA, "Effect")}
${fieldTable(schema, SCHEMA, "Ability")}
${fieldTable(schema, SCHEMA, "Characteristics")}
${fieldTable(schema, SCHEMA, "CardTags")}

---

## What the persist gate refuses

A refusal is visible; a banked guess is not. These are the defects
${link(GATE, "validateClauses")} looks for in a model answer.

${listSection(gate, GATE, "ViolationKind", "One per way an answer can be wrong.")}
`;
}

export function sources(root = ROOT): Record<string, string> {
  return Object.fromEntries([SCHEMA, PROMPT, GATE, DERIVE].map((f) => [f, readFileSync(join(root, f), "utf8")]));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = join(ROOT, OUT);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, renderSchemaDoc(sources()));
  console.log(`wrote ${OUT}`);
}
