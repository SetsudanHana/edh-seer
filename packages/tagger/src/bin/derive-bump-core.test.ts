import { describe, expect, it } from "vitest";
import { parseArgs, planSteps, rewriteDeriveVersion } from "./derive-bump-core.js";

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
});
