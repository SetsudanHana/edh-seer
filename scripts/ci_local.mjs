#!/usr/bin/env node
/** `npm run ci:local` -- every `run:` step of the `test` job in .github/workflows/ci.yml, in CI's
 *  order, stopping at the first failure and naming it (#1483).
 *
 *  Two CI-only failures on #1479 each cost a full round because the "four gates" were not every
 *  step. The step list is READ from ci.yml, never copied, so the two cannot drift; `npm ci` is the
 *  one step skipped (you have node_modules). MONGO_TEST_URI defaults to the local container, as CI's
 *  service does, so the database suites run instead of skipping.
 *
 *  Run: node scripts/ci_local.mjs [--self-test | --list]. Node built-ins only. */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = resolve(ROOT, ".github", "workflows", "ci.yml");

/** The `run:` commands of the `test` job, minus the install. */
export function parseSteps(yaml) {
  const steps = [];
  let inJob = false;
  for (const line of yaml.split("\n")) {
    const job = line.match(/^ {2}([A-Za-z_][\w-]*):\s*$/);
    if (job) inJob = job[1] === "test";
    const run = inJob && line.match(/^\s*- run: (.+?)\s*$/);
    if (run && run[1] !== "npm ci") steps.push(run[1]);
  }
  return steps;
}

function selfTest() {
  const must = (ok, m) => { if (!ok) throw new Error(`self-test failed: ${m}`); };
  const sample = "jobs:\n  test:\n    steps:\n      - run: npm ci\n      # c\n      - run: npm run a && b\n  next:\n    steps:\n      - run: npm run other\n";
  const got = parseSteps(sample);
  must(got.length === 1 && got[0] === "npm run a && b", "only the test job's steps, without npm ci");
  const real = parseSteps(readFileSync(WORKFLOW, "utf8"));
  for (const need of ["npm run typecheck", "npm test", "npm run lint:bins", "npm run lint:ceilings", "npm run lint", "npm run lint:redos"]) {
    must(real.includes(need), `ci.yml's test job no longer runs \`${need}\``);
  }
  console.log(`self-test: ${real.length} steps read from ci.yml`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) { selfTest(); return 0; }
  const steps = parseSteps(readFileSync(WORKFLOW, "utf8"));
  if (args.includes("--list")) { console.log(steps.join("\n")); return 0; }
  const env = { ...process.env, MONGO_TEST_URI: process.env.MONGO_TEST_URI || "mongodb://localhost:27017" };
  const t0 = Date.now();
  for (const [i, cmd] of steps.entries()) {
    console.log(`\n=== ci:local ${i + 1}/${steps.length}: ${cmd}`);
    const t = Date.now();
    const r = spawnSync(cmd, { cwd: ROOT, env, shell: true, stdio: "inherit" });
    const code = r.status ?? 1;
    console.log(`=== exit ${code} in ${((Date.now() - t) / 1000).toFixed(1)}s: ${cmd}`);
    if (code !== 0) { console.log(`\nci:local FAILED at step ${i + 1}/${steps.length}: ${cmd}`); return code; }
  }
  console.log(`\nci:local: all ${steps.length} steps passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return 0;
}

process.exitCode = main();
