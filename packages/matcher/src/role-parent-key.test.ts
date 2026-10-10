import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { deckSlack } from "./cut-list.js";
import { BUILD_PARENTS } from "./build.js";

/** #1168: a role parent is SELECTED by its `key`, never by its display name. A rename ("Interaction"
 *  -> "Board control") silently unwired three readers before; this fails on the next one. */
const ROOTS = [join(__dirname), join(__dirname, "../../web/client/src")];
const NAME_MATCH = /(===|!==)\s*"(Interaction|Card advantage|Ramp|Board wipes)"|"(Interaction|Card advantage|Ramp|Board wipes)"\s*(===|!==)/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "node_modules" ? [] : sources(p);
    return /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });
}

test("no non-test source selects a role parent by its display name", () => {
  const hits = ROOTS.flatMap(sources).flatMap((p) =>
    readFileSync(p, "utf8").split("\n").flatMap((l, i) => (!/^\s*(\/\/|\*|\/\*)/.test(l) && NAME_MATCH.test(l) ? [`${p}:${i + 1}: ${l.trim()}`] : [])));
  expect(hits).toEqual([]);
});

test("deckSlack carries the parent's key so a reader never has to match the name", () => {
  const parents = BUILD_PARENTS.map((p) => ({ name: `Renamed ${p.key}`, key: p.key, count: 20, target: 10, leaves: p.leaves }));
  expect(deckSlack(parents).map((s) => s.key).sort()).toEqual(BUILD_PARENTS.map((p) => p.key).sort());
});
