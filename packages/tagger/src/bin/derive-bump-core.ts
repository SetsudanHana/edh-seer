/** PURE CORE OF `derive-bump.ts`: argument parsing, the derive.ts text rewrite and the step plan.
 *  No I/O here, so the test needs neither Mongo nor the real derive.ts. */

export type Mode = "bump" | "restamp";
export type Args =
  | { mode: "bump"; issue: number; note: string; dryRun: boolean }
  | { mode: "restamp"; dryRun: boolean };

export interface Step {
  name: string;
  cmd: string;
  args: string[];
  /** Workspace directory (relative to the repo root) the command runs in; default the root. */
  cwd?: string;
  /** Steps 1-6 stop the run on a non-zero exit; the ratchets, the freshness check and the stamp tests only report. */
  stopOnFail: boolean;
}

export function parseArgs(argv: string[]): Args {
  let issue: string | undefined;
  let note: string | undefined;
  let restamp = false;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--restamp") restamp = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--issue" || a === "--note") {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value, got ${v === undefined ? "nothing" : `"${v}"`}`);
      if (a === "--issue") issue = v;
      else note = v;
    }
    else throw new Error(`unknown argument: ${a}`);
  }
  if (restamp) return { mode: "restamp", dryRun };
  if (issue === undefined) throw new Error("bump mode needs --issue N (or pass --restamp)");
  if (!/^[1-9]\d*$/.test(issue)) throw new Error(`--issue must be a positive integer, got "${issue}"`);
  if (note === undefined || note.trim() === "") throw new Error("bump mode needs --note \"text\" (or pass --restamp)");
  if (/[\r\n]/.test(note)) throw new Error("--note must not contain a newline: one line per version");
  return { mode: "bump", issue: Number(issue), note, dryRun };
}

const CONST_RE = /^export const DERIVE_VERSION = (\d+);$/gm;

/** Bump `DERIVE_VERSION` and add its `// N+1: #issue -- note` line directly above the const, after
 *  the existing `// N: ...` line. Throws unless the const appears exactly once and is preceded by
 *  its `// N:` line. */
export function rewriteDeriveVersion(src: string, issue: number, note: string): { text: string; from: number; to: number } {
  const hits = [...src.matchAll(CONST_RE)];
  if (hits.length !== 1) throw new Error(`expected \`export const DERIVE_VERSION = N;\` exactly once, found ${hits.length}`);
  const m = hits[0];
  const from = Number(m[1]);
  const to = from + 1;
  const before = src.slice(0, m.index);
  const lastLine = before.slice(0, -1).split("\n").pop() ?? "";
  if (!before.endsWith("\n") || !lastLine.startsWith(`// ${from}:`)) {
    throw new Error(`the line above DERIVE_VERSION must start with "// ${from}:" (one line per version, newest last)`);
  }
  const text = `${before}// ${to}: #${issue} -- ${note}\nexport const DERIVE_VERSION = ${to};${src.slice(m.index + m[0].length)}`;
  return { text, from, to };
}

const tsx = (name: string, file: string, args: string[] = [], stopOnFail = true, cwd?: string): Step => ({
  name,
  cmd: "npx",
  args: ["tsx", file, ...args],
  stopOnFail,
  ...(cwd ? { cwd } : {}),
});

const vitest = (file: string, cwd: string): Step => ({
  name: `verify ${file}`,
  cmd: "npx",
  args: ["vitest", "run", file],
  cwd,
  stopOnFail: false,
});

/** CHECK mode only: a moved ratchet line needs a written explanation by a human, so `--bank` is
 *  never passed. */
export function planSteps(mode: Mode): Step[] {
  const steps: Step[] = [];
  if (mode === "bump") steps.push({ name: "bump", cmd: "(edit)", args: ["packages/tagger/src/derive/derive.ts"], stopOnFail: true });
  steps.push(
    // --force always: derive-corpus is a no-op at an unchanged version.
    tsx("derive-corpus", "packages/tagger/src/bin/derive-corpus.ts", ["--force"]),
    tsx("refresh-fixtures", "research/mana/refresh-fixtures.mts"),
    tsx("gen-quality-weights", "packages/matcher/src/bin/gen-quality-weights.ts"),
    // theme-stats.json is the IDF table behind every headline theme; an absent tag scores log(N+1),
    // so a stale file mis-ranks decks (#1428). Regenerated from the fresh derive, then re-counted.
    tsx("gen-theme-stats", "packages/matcher/src/bin/gen-theme-stats.ts"),
    tsx("gen-schema-docs", "packages/tagger/src/bin/gen-schema-docs.ts"),
    tsx("role-ratchet", "packages/instruments/src/role-ratchet.ts", [], false),
    tsx("dropped-clauses", "packages/instruments/src/dropped-clauses.ts", [], false),
    tsx("theme-stats-fresh", "packages/instruments/src/theme-stats-fresh.ts", [], false),
    vitest("src/fixture-derive-version.test.ts", "packages/matcher"),
    vitest("src/quality-weights.test.ts", "packages/matcher"),
    vitest("src/bin/gen-schema-docs.test.ts", "packages/tagger"),
  );
  return steps;
}

/** One input a step after the bump reads from disk (Mongo is checked separately). `step` is a name in
 *  `planSteps`. Found by reading what each step opens (#1484), not guessed. */
export interface PreflightItem {
  path: string;
  /** required: the step throws or reports failure without it. optional: it runs, on less. */
  level: "required" | "optional";
  step: string;
  why: string;
  /** Set when `path` is a DIRECTORY that must hold at least one file whose name matches. A step that
   *  reads every matching file fits on fewer inputs, silently, when the directory is empty. */
  files?: RegExp;
}

const M = "packages/matcher/src";
const fixture = (name: string): PreflightItem => ({
  path: `${M}/${name}`,
  level: "required",
  step: "refresh-fixtures",
  why: "research/mana/refresh-fixtures.mts reads the fixture to refresh each card entry in place",
});

/** Relative to the repo root. The first two are the ones that bit: `.edhrec-cache/` is gitignored, so a
 *  fresh checkout lacks it, and step 4 died on it AFTER the bump had edited derive.ts and re-derived. */
export const PREFLIGHT: PreflightItem[] = [
  { path: ".edhrec-cache/precon/precon.json", level: "required", step: "gen-quality-weights",
    why: "gen-quality-weights throws \"no EDHREC cache\" without it; fetch with research/web/precon-vs-edhrec.ts (the precon_*.json pages sit beside it)" },
  { path: ".edhrec-cache/precon", files: /^precon_.*\.json$/, level: "optional", step: "gen-quality-weights",
    why: "gen-quality-weights reads every precon_*.json page beside precon.json (the cut/add pairs); with none the weights fit on the guide pairs alone" },
  { path: "docs/measurements/2026-09-27-precon-calibration/guides", files: /\.json$/, level: "optional", step: "gen-quality-weights",
    why: "gen-quality-weights skips the hand-built guide pairs without it, so the weights fit on fewer pairs than the full checkout and quality-weights.json differs" },
  { path: `${M}/fixtures/goldfish-cards.json`, level: "required", step: "refresh-fixtures", why: "read and rewritten by refresh-fixtures.mts" },
  { path: `${M}/fixtures/mana-colour-sources.json`, level: "required", step: "refresh-fixtures", why: "read and rewritten by refresh-fixtures.mts" },
  ...["ramp-colour.fixtures", "same-job.fixtures", "similar.fixtures", "quality.fixtures", "same-job.labels.cards", "redundancy.fixtures"]
    .map((n) => fixture(`${n}.json`)),
  { path: "packages/instruments/role-membership.json", level: "required", step: "role-ratchet", why: "the banked snapshot role-ratchet compares against" },
  { path: "packages/instruments/role-membership-untagged.json", level: "required", step: "role-ratchet", why: "the banked untagged list role-ratchet compares against" },
  { path: "packages/instruments/dropped-clauses.json", level: "required", step: "dropped-clauses", why: "the banked snapshot dropped-clauses compares against" },
];

/** The pure decision: given what exists (`exists`) and how many files in a directory match a pattern
 *  (`count`), what stops the run and what only warns. A directory item (`files` set) is judged by
 *  `count` alone, so a missing directory and an empty one both read as "none". */
export function preflight(
  exists: (path: string) => boolean,
  count: (dir: string, files: RegExp) => number,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const i of PREFLIGHT) {
    const ok = i.files ? count(i.path, i.files) > 0 : exists(i.path);
    if (ok) continue;
    const what = i.files ? `${i.path} holds no file matching ${i.files}` : `missing ${i.path}`;
    if (i.level === "required") errors.push(`${what} -- needed by step "${i.step}": ${i.why}`);
    else warnings.push(`${what} -- optional for step "${i.step}": ${i.why}`);
  }
  return { errors, warnings };
}
