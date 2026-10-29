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
  /** Steps 1-5 stop the run on a non-zero exit; the ratchets and the stamp tests only report. */
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
    else if (a === "--issue") issue = argv[++i];
    else if (a === "--note") note = argv[++i];
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
    tsx("gen-schema-docs", "packages/tagger/src/bin/gen-schema-docs.ts"),
    tsx("role-ratchet", "packages/instruments/src/role-ratchet.ts", [], false),
    tsx("dropped-clauses", "packages/instruments/src/dropped-clauses.ts", [], false),
    vitest("src/fixture-derive-version.test.ts", "packages/matcher"),
    vitest("src/quality-weights.test.ts", "packages/matcher"),
    vitest("src/bin/gen-schema-docs.test.ts", "packages/tagger"),
  );
  return steps;
}
