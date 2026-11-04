import { describe, expect, it } from "vitest";
import { parseArgs, planSteps, PREFLIGHT, preflight, rewriteDeriveVersion } from "./derive-bump-core.js";

const SRC = [
  "// 408: #1395 -- older note",
  "// 409: #1403 -- newest note",
  "export const DERIVE_VERSION = 409;",
  "",
  "export const OTHER = 1;",
].join("\n");

describe("rewriteDeriveVersion", () => {
  it("bumps N to N+1 and puts the new comment directly above the const", () => {
    const r = rewriteDeriveVersion(SRC, 1412, "a note");
    expect(r.from).toBe(409);
    expect(r.to).toBe(410);
    expect(r.text.split("\n")).toEqual([
      "// 408: #1395 -- older note",
      "// 409: #1403 -- newest note",
      "// 410: #1412 -- a note",
      "export const DERIVE_VERSION = 410;",
      "",
      "export const OTHER = 1;",
    ]);
  });
  it("throws on zero consts", () => {
    expect(() => rewriteDeriveVersion("// 1: x\nconst A = 1;", 1, "n")).toThrow(/exactly once/);
  });
  it("throws on two consts", () => {
    expect(() => rewriteDeriveVersion(`${SRC}\n${SRC}`, 1, "n")).toThrow(/exactly once/);
  });
  it("throws when the version line convention is missing", () => {
    expect(() => rewriteDeriveVersion("export const DERIVE_VERSION = 409;", 1, "n")).toThrow(/\/\/ 409:/);
    expect(() => rewriteDeriveVersion("// 408: x\nexport const DERIVE_VERSION = 409;", 1, "n")).toThrow(/\/\/ 409:/);
  });
});

describe("parseArgs", () => {
  it("parses a bump", () => {
    expect(parseArgs(["--issue", "1412", "--note", "hi"])).toEqual({ mode: "bump", issue: 1412, note: "hi", dryRun: false });
  });
  it("parses restamp and dry-run without issue/note", () => {
    expect(parseArgs(["--restamp", "--dry-run"])).toEqual({ mode: "restamp", dryRun: true });
  });
  it("refuses a bump with no issue or note", () => {
    expect(() => parseArgs(["--note", "x"])).toThrow(/--issue/);
    expect(() => parseArgs(["--issue", "1"])).toThrow(/--note/);
  });
  it("refuses a bad issue number", () => {
    expect(() => parseArgs(["--issue", "abc", "--note", "x"])).toThrow(/--issue/);
  });
  it("refuses a newline in the note", () => {
    expect(() => parseArgs(["--issue", "1", "--note", "a\nb"])).toThrow(/newline/);
  });
  it("refuses a flag where a value belongs", () => {
    expect(() => parseArgs(["--issue", "1412", "--note", "--dry-run"])).toThrow(/--note/);
    expect(() => parseArgs(["--issue", "--note", "x"])).toThrow(/--issue/);
    expect(() => parseArgs(["--issue", "1", "--note"])).toThrow(/--note/);
  });
  it("refuses an unknown flag", () => {
    expect(() => parseArgs(["--issue", "1", "--note", "x", "--bogus"])).toThrow(/unknown/);
  });
});

describe("planSteps", () => {
  const all = (p: ReturnType<typeof planSteps>) => p.flatMap((s) => [s.cmd, ...s.args]);
  it("bump plan starts with the bump and keeps --force on derive-corpus", () => {
    const p = planSteps("bump");
    expect(p[0].name).toBe("bump");
    const d = p.find((s) => s.args.some((a) => a.endsWith("derive-corpus.ts")));
    expect(d?.args).toContain("--force");
  });
  it("restamp plan omits the bump and keeps --force", () => {
    const p = planSteps("restamp");
    expect(p.some((s) => s.name === "bump")).toBe(false);
    expect(p.find((s) => s.args.some((a) => a.endsWith("derive-corpus.ts")))?.args).toContain("--force");
    expect(p.length).toBe(planSteps("bump").length - 1);
  });
  it("ratchet steps never bank and do not stop the run", () => {
    for (const mode of ["bump", "restamp"] as const) {
      const p = planSteps(mode);
      expect(all(p)).not.toContain("--bank");
      const r = p.filter((s) => s.args.some((a) => /role-ratchet|dropped-clauses/.test(a)));
      expect(r).toHaveLength(2);
      expect(r.every((s) => !s.stopOnFail)).toBe(true);
    }
  });
  it("regenerates theme-stats.json after the derive, then checks it fresh without stopping", () => {
    for (const mode of ["bump", "restamp"] as const) {
      const p = planSteps(mode);
      const names = p.map((s) => s.name);
      const gen = p.find((s) => s.args.some((a) => a.endsWith("gen-theme-stats.ts")));
      const chk = p.find((s) => s.args.some((a) => a.endsWith("theme-stats-fresh.ts")));
      expect(gen?.stopOnFail).toBe(true);
      expect(chk?.stopOnFail).toBe(false);
      expect(names.indexOf(gen!.name)).toBeGreaterThan(names.indexOf("derive-corpus"));
      expect(names.indexOf(chk!.name)).toBeGreaterThan(names.indexOf(gen!.name));
    }
  });
});

describe("preflight (#1484)", () => {
  const CACHE = ".edhrec-cache/precon/precon.json";
  const PAGES_DIR = ".edhrec-cache/precon";
  const GUIDES = "docs/measurements/2026-09-27-precon-calibration/guides";
  const M = "packages/matcher/src";
  const REQUIRED = [
    CACHE,
    `${M}/fixtures/goldfish-cards.json`,
    `${M}/fixtures/mana-colour-sources.json`,
    ...["ramp-colour.fixtures", "same-job.fixtures", "similar.fixtures", "quality.fixtures", "same-job.labels.cards", "redundancy.fixtures"].map((n) => `${M}/${n}.json`),
    "packages/instruments/role-membership.json",
    "packages/instruments/role-membership-untagged.json",
    "packages/instruments/dropped-clauses.json",
  ];
  const OPTIONAL = [GUIDES, PAGES_DIR];
  const present = (p: string) => PREFLIGHT.some((i) => i.path === p);
  const some = () => 3; // every directory holds files
  const probe = (missing: string[] = [], empty: string[] = []) => ({
    exists: (p: string) => present(p) && !missing.includes(p),
    count: (dir: string) => (empty.includes(dir) || missing.includes(dir) ? 0 : 3),
  });

  it("pins the FULL list: deleting any entry fails here", () => {
    expect(PREFLIGHT.filter((i) => i.level === "required").map((i) => i.path).sort()).toEqual([...REQUIRED].sort());
    expect(PREFLIGHT.filter((i) => i.level === "optional").map((i) => i.path).sort()).toEqual([...OPTIONAL].sort());
    expect(PREFLIGHT.find((i) => i.path === CACHE)).toMatchObject({ level: "required", step: "gen-quality-weights" });
    expect(PREFLIGHT.find((i) => i.path === GUIDES)).toMatchObject({ level: "optional", step: "gen-quality-weights" });
  });
  it("names only steps that exist in the plan", () => {
    const names = new Set(planSteps("restamp").map((s) => s.name));
    for (const i of PREFLIGHT) expect(names.has(i.step), `${i.path} -> ${i.step}`).toBe(true);
  });
  it("all present: no errors, no warnings", () => {
    expect(preflight(probe().exists, some)).toEqual({ errors: [], warnings: [] });
  });
  it("cache index missing: an error naming the path and the step", () => {
    const r = preflight(probe([CACHE]).exists, some);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain(CACHE);
    expect(r.errors[0]).toContain("gen-quality-weights");
    expect(r.warnings).toEqual([]);
  });
  it("guides directory missing or empty: a warning, no error", () => {
    for (const r of [preflight(probe().exists, (d) => (d === GUIDES ? 0 : 3)), preflight(probe([GUIDES]).exists, (d) => (d === GUIDES ? 0 : 3))]) {
      expect(r.errors).toEqual([]);
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0]).toContain(GUIDES);
    }
  });
  it("a cache with precon.json but no precon_*.json pages: a warning, no error", () => {
    const r = preflight(probe().exists, (d) => (d === PAGES_DIR ? 0 : 3));
    expect(r.errors).toEqual([]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("precon_");
  });
  it("hands the directory checks their patterns, and one matching file is enough", () => {
    const seen: [string, string][] = [];
    const r = preflight(probe().exists, (d, re) => { seen.push([d, String(re)]); return 1; });
    expect(r).toEqual({ errors: [], warnings: [] });
    expect(seen).toContainEqual([GUIDES, String(/\.json$/)]);
    expect(seen.find(([d]) => d === PAGES_DIR)?.[1]).toContain("precon_");
  });
  it("everything missing: every required one is an error", () => {
    const r = preflight(() => false, () => 0);
    expect(r.errors).toHaveLength(REQUIRED.length);
  });
});
