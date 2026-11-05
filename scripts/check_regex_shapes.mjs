#!/usr/bin/env node
/** Regex shapes CodeQL has failed this repo's PRs on (#1483), caught before the push.
 *
 *  CodeQL runs only on GitHub, so `js/polynomial-redos` and `js/incomplete-multi-character-sanitization`
 *  each cost a full CI round, and the same few shapes recurred (#208, #1063, #1207, #1297, #1358, #1479).
 *  This is a cheap local approximation of those shapes, NOT a ReDoS prover: it reads regex LITERALS.
 *
 *  DIFF-ONLY. It checks lines added since `git merge-base origin/main HEAD` (falling back to `main`
 *  when origin/main is missing, said on stderr) plus uncommitted and untracked files, in .ts/.tsx/.mjs.
 *  Existing code needs no allowlist: only what a branch adds can fail. Tests are in scope, because
 *  CodeQL flagged a test once. This file is excluded: its self-test samples are the shapes themselves.
 *
 *  Run: node scripts/check_regex_shapes.mjs [--self-test | --all]
 *    --all  scans every tracked file whole and prints the hits (a census; always exits 0).
 *  Node built-ins only. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SELF = "scripts/check_regex_shapes.mjs";
const inScope = (f) => /\.(ts|tsx|mjs)$/.test(f) && f !== SELF;

// ---- 1. Pull regex literals out of one source line ------------------------------------------------

// A `/` after one of these opens a regex; after an identifier, `)` or `]` it is division. `<` and `>`
// are left out so JSX `</div>` is not read as a regex; `=>` is added back below.
const REGEX_AFTER = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "~", "^"]);
const KEYWORDS = new Set(["return", "typeof", "case", "in", "of", "void", "delete", "throw", "else", "do"]);

/** `[{ body, flags }]` for each regex literal on the line. Comments and strings are skipped. */
export function regexLiterals(line) {
  const out = [];
  let i = 0, prev = "", prevWord = "";
  while (i < line.length) {
    const c = line[i];
    if (c === '"' || c === "'" || c === "`") {
      i++;
      while (i < line.length && line[i] !== c) i += line[i] === "\\" ? 2 : 1;
      i++; prev = "s"; prevWord = ""; continue;
    }
    if (c === "/") {
      if (line[i + 1] === "/") break;
      if (line[i + 1] === "*") { const e = line.indexOf("*/", i + 2); if (e < 0) break; i = e + 2; continue; }
      const arrow = prev === ">" && line[line.lastIndexOf(">", i) - 1] === "=";
      if (REGEX_AFTER.has(prev) || arrow || KEYWORDS.has(prevWord)) {
        let j = i + 1, inClass = false, closed = false;
        for (; j < line.length; j++) {
          const d = line[j];
          if (d === "\\") { j++; continue; }
          if (inClass) { if (d === "]") inClass = false; continue; }
          if (d === "[") inClass = true;
          else if (d === "/") { closed = true; break; }
        }
        if (!closed) break;
        const body = line.slice(i + 1, j);
        let k = j + 1;
        while (k < line.length && /[a-z]/.test(line[k])) k++;
        out.push({ body, flags: line.slice(j + 1, k) });
        i = k; prev = "r"; prevWord = ""; continue;
      }
      prev = "/"; i++; continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    if (/[\w$]/.test(c)) {
      let k = i;
      while (k < line.length && /[\w$]/.test(line[k])) k++;
      prevWord = line.slice(i, k); prev = "w"; i = k; continue;
    }
    prev = c; prevWord = ""; i++;
  }
  return out;
}

// ---- 2. The shapes -------------------------------------------------------------------------------

/** Class ranges and group ranges of a regex body, escapes honoured. */
function structure(body) {
  const classes = [], groups = [], stack = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "\\") { i++; continue; }
    if (c === "[") {
      const start = i;
      for (i++; i < body.length && body[i] !== "]"; i++) if (body[i] === "\\") i++;
      classes.push([start, i]);
    } else if (c === "(") stack.push(i);
    else if (c === ")" && stack.length) {
      const open = stack.pop(), q = body[i + 1] ?? "";
      groups.push({ open, close: i, optional: q === "?" || q === "*" || body.startsWith("{0", i + 1), repeated: q === "+" || q === "*" || /^\{\d+,/.test(body.slice(i + 1)) });
    }
  }
  return { classes, groups };
}

// Literal text allowed BETWEEN two quantified atoms and still counted as adjacent: words, spaces and
// punctuation, `\b`, escaped punctuation. `\s+and\s+` and `\s+and only\b.*` are the recurring forms.
const LIT = String.raw`(?:[A-Za-z0-9 ,;:'"_~=-]|\\[bB\W])*`;
const SPACE_Q = String.raw`\\s[*+]\??`;
const DOT_Q = String.raw`(?<!\\)\.[*+]\??`;

/** Rule names fired by one regex literal. `line` is the whole source line (for how it is used). */
export function shapesOf({ body }, line = "") {
  const hits = [];
  const { classes, groups } = structure(body);
  const inClass = (p) => classes.some(([a, b]) => p >= a && p <= b);
  const tokens = (re) => [...body.matchAll(new RegExp(re, "g"))].filter((m) => !inClass(m.index));

  // R1. \s*/\s+ beside .* / .+ or another \s*/\s+ (at most a literal between): the quantifiers can
  // split a run of spaces many ways, and an unanchored start retries from every position. #1358, #1479.
  const pair = new RegExp(`(${SPACE_Q}|${DOT_Q})(${LIT})(${SPACE_Q}|${DOT_Q})`, "g");
  for (const m of body.matchAll(pair)) {
    if (inClass(m.index)) continue;
    if (!m[0].includes("\\s")) continue; // `.*.*` is a different defect
    // `\s*\/\s*`: one mandatory punctuation char that \s cannot match splits the two runs, so a run of
    // spaces has one way to divide. Words (`\s+and\s+`) and any `.*` stay flagged.
    if (m[1].startsWith("\\s") && m[3].startsWith("\\s") && /^\\?[^\w\s]$/.test(m[2])) continue;
    hits.push("space-adjacent");
    break;
  }
  // R2. \s*/\s+ directly beside an optional group `(...)?`: `\.?\s*(?:\([^)]*\))?\s*$`, #208, #1297.
  // A group that cannot match whitespace at all (`(?:es)?\s+`) shares nothing with the \s run.
  const spaceCapable = (g) => /\\[sSWDB]|(?<!\\)\.| |\[\^|\[[^\]]*\\s/.test(body.slice(g.open, g.close));
  for (const m of tokens(SPACE_Q)) {
    const end = m.index + m[0].length;
    if (groups.some((g) => g.optional && spaceCapable(g) && (g.open === end || g.close + 1 === m.index || g.close + 2 === m.index && /[?*]/.test(body[g.close + 1])))) { hits.push("space-optional-group"); break; }
  }
  // R3. `(?:^|\n)\s*`: the newline and \s* overlap. Use /^.../m. #1063.
  if (/\(\??:?\^\|\\n\)\\s[*+]/.test(body)) hits.push("newline-space");
  // R4. `[^}]+` / `[^\]]+` inside a repeated group: the class admits the delimiter, so `{{{{` splits
  // many ways. #1207, #1297.
  for (const m of body.matchAll(/\[\^(?:\}|\\\])\][*+]/g)) {
    if (groups.some((g) => g.repeated && g.open < m.index && m.index < g.close)) { hits.push("delimiter-class-in-repeated-group"); break; }
  }
  // R5. `<[^>]+>` tag stripping: js/incomplete-multi-character-sanitization, even in a test.
  if (/<\[\^>\][*+]>/.test(body)) hits.push("tag-strip");
  // R6. An UNANCHORED leading \s+/\s* with something after it, run through search/exec/replace/test:
  // the engine retries from every space of a long run. #1479 (`/\s+except\b/`). A bare `/\s+/` has no
  // tail to fail, and a `split` is not a search, so neither counts.
  const lead = body.match(new RegExp(`^${SPACE_Q}`));
  if (lead && body.length > lead[0].length && !/\.split\(/.test(line) && /\.(search|exec|replace|replaceAll|test|match)\(/.test(line)) hits.push("leading-space");
  // R7. The class form of R6: an UNANCHORED leading quantified class with a tail, run as a search. A long
  // run of the class's characters that the tail then rejects is rescanned from every start. #1469
  // (`/[.,;]+(?= |$)/g` on a run of commas).
  const leadClass = body.match(/^\[(?:\\.|[^\]\\])*\][*+]\??/);
  if (leadClass && body.length > leadClass[0].length && !/\.split\(/.test(line) && /\.(search|exec|replace|replaceAll|test|match)\(/.test(line)) hits.push("leading-class");
  // R8. In an UNANCHORED pattern, a quantified class that can match a space, directly followed by a space
  // (literal or \s): the run of spaces splits between the two many ways, retried from every start. #1469
  // (`(?:dealt to [a-z ]+ )?is halved`). An anchored `^…` pattern has one start, and CodeQL passes those here.
  for (const [a, b] of body.startsWith("^") ? [] : classes) {
    const q = body[b + 1];
    if (q !== "+" && q !== "*") continue;
    const cls = body.slice(a, b + 1);
    if (cls.startsWith("[^") || !(cls.includes(" ") || cls.includes("\\s"))) continue;
    const after = body.slice(b + 2).replace(/^\?/, "");
    if (after.startsWith(" ") || after.startsWith("\\s")) { hits.push("space-class-then-space"); break; }
  }
  return [...new Set(hits)];
}

const REWRITE = {
  "space-adjacent": "use ONE literal space (` and `), or `search` + `slice`, instead of \\s+ beside .* / another \\s+",
  "space-optional-group": "cut the optional tail with indexOf/slice/trim and a one-character anchor, not \\s* beside (...)?",
  "newline-space": "use /^.../m instead of (?:^|\\n)\\s*",
  "delimiter-class-in-repeated-group": "use [^{}] / [^[\\]] (exclude the opener too) inside a repeated group",
  "tag-strip": "read HTML with DOMParser (`.body.textContent`); do not strip tags with a regex",
  "leading-space": "search for a literal (` except\\b`) and `slice`, or anchor the pattern with ^",
  "leading-class": "walk the string once (a char loop or indexOf), or anchor the pattern with ^",
  "space-class-then-space": "take the space out of the class, or find the literal tail with indexOf and slice",
};

/** `[{ rule, pattern }]` for one source line; comment lines yield nothing. */
export function checkLine(line) {
  const t = line.trim();
  if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return [];
  const out = [];
  for (const lit of regexLiterals(line)) for (const rule of shapesOf(lit, line)) out.push({ rule, pattern: `/${lit.body}/${lit.flags}` });
  return out;
}

// ---- 3. Which lines ------------------------------------------------------------------------------

const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });

function baseRef() {
  for (const ref of ["origin/main", "main"]) {
    try {
      const sha = git("merge-base", ref, "HEAD").trim();
      if (ref !== "origin/main") console.error(`check_regex_shapes: origin/main is missing, diffing against local ${ref}`);
      return sha;
    } catch { /* try the next */ }
  }
  console.error("check_regex_shapes: no origin/main or main to diff against (a shallow checkout needs fetch-depth: 0)");
  process.exit(1);
}

/** `[{ file, line, text }]` added since `base`, working tree included, plus untracked files whole. */
function addedLines(base) {
  const out = [];
  let file = null, n = 0, header = false;
  for (const l of git("diff", "-U0", "--no-color", "--no-ext-diff", base, "--", "*.ts", "*.tsx", "*.mjs").split("\n")) {
    if (l.startsWith("diff --git ")) { header = true; continue; }
    if (header && l.startsWith("+++ ")) { file = l.startsWith("+++ b/") ? l.slice(6) : null; continue; }
    const h = l.match(/^@@ -\S+ \+(\d+)/);
    if (h) { n = Number(h[1]); header = false; continue; }
    if (l.startsWith("+") && file && inScope(file)) out.push({ file, line: n++, text: l.slice(1) });
  }
  return [...out, ...wholeFiles(git("ls-files", "--others", "--exclude-standard").split("\n"))];
}

function wholeFiles(files) {
  const out = [];
  for (const f of files.filter((x) => x && inScope(x))) {
    readFileSync(resolve(ROOT, f), "utf8").split("\n").forEach((text, i) => out.push({ file: f, line: i + 1, text }));
  }
  return out;
}

// ---- 4. Self-test --------------------------------------------------------------------------------

const MUST_FLAG = [
  String.raw`s.search(/\s+except\b/i)`,
  String.raw`s.replace(/\s+except\b/i, "")`,
  String.raw`const r = /\s+and\s+(?=x)/;`,
  String.raw`const r = /\s+and\s+/;`,
  String.raw`x.match(/^Enchant ([^\n(]+?)\.?\s*(?:\([^)]*\))?\s*$/m)`,
  String.raw`x.replace(/\s+and only\b.*$/i, "")`,
  String.raw`x.match(/a.*\s+b/)`,
  String.raw`x.match(/a\s+(?:each\s+)?b/)`,
  String.raw`x.match(/(?:^|\n)\s*Add /)`,
  String.raw`x.match(/(?:\{[^}]+\})+/)`,
  String.raw`x.match(/(?:\[[^\]]+\])*/)`,
  String.raw`x.replace(/<[^>]+>/g, "")`,
  String.raw`const strip = (h) => h.replace(/<[^>]+>/g, "");`,
  String.raw`const f = (s) => /\s*foo/.test(s);`,
  String.raw`const rest = s.replace(/[.,;]+(?= |$)/g, "");`,
  String.raw`if (/\bdamage (?:dealt to [a-z ]+ )?is halved\b/.test(t)) return "halved";`,
  String.raw`x.match(/[^ ]+ x/)`,
];
const MUST_PASS = [
  String.raw`s.search(/ except\b/i)`,
  String.raw`/^(?:this\b|it and\b|~)/i.test(s)`,
  String.raw`s.split(/[\s,]+/)`,
  String.raw`/^\s*$/.test(s)`,
  String.raw`s.replace(/\s+/g, " ")`,
  String.raw`s.split(/[,;]+/)`,
  String.raw`x.match(/(?:\{[^{}]+\})+/)`,
  String.raw`x.match(/search(?:es)?\s+(?:your|their)\b/i)`,
  String.raw`x.match(/\d+\s*\/\s*\d+/)`,
  String.raw`x.match(/^Add /m)`,
  String.raw`const t = new DOMParser().parseFromString(html, "text/html").body.textContent;`,
  String.raw`x.match(/\[[^[\]]+\]/)`,
  String.raw`x.match(/^Enchant ([^\n]+)$/m)`,
  String.raw`const half = total / 2 / 3;`,
  String.raw`return <div>x</div>;`,
  String.raw`// s.search(/\s+except\b/i)`,
  String.raw`const s = "/\\s+and\\s+/"; // text only`,
  String.raw`x.match(/[\s+]/)`,
  String.raw`x.match(/^[a-z]+ is halved/)`,
  String.raw`x.match(/^the next [\w ]*?spell (?:with [\w ]+ )?you cast$/i)`,
  String.raw`x.replace(/[.,;]/g, "")`,
  String.raw`x.match(/\bdamage (?:dealt to [a-z]+ )?is halved\b/)`,
];

function selfTest() {
  const bad = [];
  for (const s of MUST_FLAG) if (!checkLine(s).length) bad.push(`must flag, did not: ${s}`);
  for (const s of MUST_PASS) { const h = checkLine(s); if (h.length) bad.push(`must pass, flagged ${h.map((x) => x.rule)}: ${s}`); }
  const each = new Set(MUST_FLAG.flatMap((s) => checkLine(s).map((h) => h.rule)));
  for (const r of Object.keys(REWRITE)) if (!each.has(r)) bad.push(`rule never exercised by a must-flag sample: ${r}`);
  if (bad.length) { for (const b of bad) console.error(`self-test failed: ${b}`); return 1; }
  console.log(`self-test: ${MUST_FLAG.length} shapes flagged, ${MUST_PASS.length} safe lines passed`);
  return 0;
}

// ---- 5. Main -------------------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) return selfTest();
  const all = args.includes("--all");
  const lines = all ? wholeFiles(git("ls-files").split("\n")) : addedLines(baseRef());
  let hits = 0;
  for (const { file, line, text } of lines) {
    for (const h of checkLine(text)) {
      hits++;
      console.log(`${file}:${line}: ${h.rule}: ${h.pattern}\n    safe rewrite: ${REWRITE[h.rule]}`);
    }
  }
  if (all) { console.log(`\n--all: ${hits} hit(s) over ${new Set(lines.map((l) => l.file)).size} files (census only)`); return 0; }
  if (hits) { console.log(`\n${hits} CodeQL-prone regex shape(s) in added lines.`); return 1; }
  console.log(`regex shapes: ${lines.length} added line(s) checked, none flagged`);
  return 0;
}

process.exitCode = main();
