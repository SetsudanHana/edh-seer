import { expect, test } from "vitest";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { scratchDir } from "./scratch.js";

test("the scratch directory is under tmpdir and stable across calls", () => {
  // STABLE is the requirement, not unique: the sampling bins write a draw that the scoring bins
  // read back (precision-sample -> precision-score), so mkdtemp would break the handoff. This is
  // why the fix is a private PARENT rather than a random child.
  expect(scratchDir("precision")).toBe(scratchDir("precision"));
  expect(scratchDir("precision").startsWith(tmpdir())).toBe(true);
});

test("distinct names get distinct directories", () => {
  expect(scratchDir("precision")).not.toBe(scratchDir("recall"));
});

test("the parent is private to this user, which is the whole point", () => {
  const dir = scratchDir("perm-check");
  // 0o700 on the leaf and on the per-uid parent above it: /tmp is world-writable and sticky, so a
  // predictable path there can be pre-created (or symlinked) by another local user.
  expect(statSync(dir).mode & 0o777).toBe(0o700);
  const parent = dir.slice(0, dir.lastIndexOf("/"));
  expect(statSync(parent).mode & 0o777).toBe(0o700);
  expect(parent).toContain("edh-seer-");
});
