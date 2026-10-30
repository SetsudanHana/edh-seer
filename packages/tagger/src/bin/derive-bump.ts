/** FREE. Runs every DERIVE_VERSION bump chore in order, so none is forgotten:
 *    1 bump DERIVE_VERSION + add its `// N: #issue -- note` line      (derive.ts)
 *    2 derive-corpus --force       3 research/mana/refresh-fixtures.mts
 *    4 gen-quality-weights         5 gen-theme-stats (packages/matcher/theme-stats.json)
 *    6 gen-schema-docs
 *    7 role-ratchet + dropped-clauses, CHECK mode only (never --bank: a moved line needs a written
 *      explanation by a human; a non-zero verdict is reported and makes this bin exit non-zero)
 *      and theme-stats-fresh (count check; reported the same way)
 *    8 the three stamp tests (fixture-derive-version, quality-weights, gen-schema-docs)
 *  Steps 1-6 stop at the first failure and print the `--restamp` command to resume.
 *
 *  Usage (repo root, env sourced: `set -a && source packages/tagger/.env && set +a`; needs Mongo):
 *    npm run derive:bump -- --issue N --note "text"
 *    npm run derive:bump -- --restamp          # steps 2-8 at the current version (review-fix rounds)
 *    npm run derive:bump -- --dry-run --issue N --note "text"   # prints the plan, writes nothing */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import { loadConfig } from "@edh-seer/data";
import { parseArgs, planSteps, rewriteDeriveVersion, type Step } from "./derive-bump-core.js";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const DERIVE_TS = "packages/tagger/src/derive/derive.ts";
/** The paths steps 1-6 write, for the summary's `git status --short`. */
const WRITTEN = [DERIVE_TS, "docs/reference/SCHEMA.md", "packages/matcher/theme-stats.json", "packages/matcher", "packages/instruments", "research/mana"];

const show = (s: Step) => `${s.cwd ? `(cd ${s.cwd}) ` : ""}${s.cmd} ${s.args.join(" ")}`;

/** Host and db name only -- never the URI, which may carry credentials. */
function describeTarget(uri: string, db: string): string {
  try {
    return `host ${new URL(uri).host.split("@").pop()}, db ${db}`;
  } catch {
    return `db ${db}`;
  }
}

/** CEILING: a raw MongoClient rather than `connect()` from @edh-seer/data -- that one has no
 *  timeout knob (30 s server selection) and creates an index, a write, before returning. */
async function mongoReachable(uri: string, dbName: string): Promise<boolean> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
  try {
    await client.connect();
    await client.db(dbName).command({ ping: 1 });
    return true;
  } catch {
    return false;
  } finally {
    await client.close().catch(() => {});
  }
}

async function main(): Promise<number> {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`derive-bump: ${(e as Error).message}`);
    return 2;
  }
  const plan = planSteps(args.mode);
  const src = readFileSync(`${ROOT}${DERIVE_TS}`, "utf8");
  let bumped: ReturnType<typeof rewriteDeriveVersion> | undefined;
  if (args.mode === "bump") {
    try {
      bumped = rewriteDeriveVersion(src, args.issue, args.note);
    } catch (e) {
      console.error(`derive-bump: ${(e as Error).message}`);
      return 2;
    }
  }
  const oldV = bumped ? bumped.from : Number(/^export const DERIVE_VERSION = (\d+);$/m.exec(src)?.[1]);

  if (args.dryRun) {
    console.log(`derive-bump --dry-run (${args.mode}); nothing is run or written`);
    plan.forEach((s, i) => console.log(`${i + 1}. ${s.name}: ${show(s)}${s.stopOnFail ? "" : "   [reported, does not stop]"}`));
    if (bumped) {
      console.log(`\n${DERIVE_TS} edit: ${bumped.from} -> ${bumped.to}`);
      console.log(`  + // ${bumped.to}: #${(args as { issue: number }).issue} -- ${(args as { note: string }).note}`);
      console.log(`  - export const DERIVE_VERSION = ${bumped.from};`);
      console.log(`  + export const DERIVE_VERSION = ${bumped.to};`);
    }
    return 0;
  }

  // Preflight BEFORE the bump edit: a down Mongo or unsourced env must not leave derive.ts bumped.
  const cfg = loadConfig();
  if (!(await mongoReachable(cfg.mongoUri, cfg.dbName))) {
    console.error(`derive-bump: Mongo unreachable (${describeTarget(cfg.mongoUri, cfg.dbName)}) -- source packages/tagger/.env and start Mongo; nothing was changed`);
    return 2;
  }

  const results: { name: string; code: number; ms: number; stop: boolean }[] = [];
  let failedStop: Step | undefined;
  for (const step of plan) {
    console.log(`\n$ ${show(step)}`);
    const t0 = Date.now();
    let code = 0;
    if (step.name === "bump" && bumped) {
      writeFileSync(`${ROOT}${DERIVE_TS}`, bumped.text);
    } else {
      const r = spawnSync(step.cmd, step.args, { cwd: step.cwd ? `${ROOT}${step.cwd}` : ROOT, stdio: "inherit" });
      code = r.status ?? 1;
    }
    results.push({ name: step.name, code, ms: Date.now() - t0, stop: step.stopOnFail });
    if (code !== 0 && step.stopOnFail) {
      failedStop = step;
      break;
    }
  }

  console.log("\n=== derive-bump summary ===");
  console.log(bumped ? `DERIVE_VERSION ${bumped.from} -> ${bumped.to}` : `DERIVE_VERSION ${oldV} (restamp)`);
  for (const r of results) console.log(`  exit ${r.code}  ${(r.ms / 1000).toFixed(1)}s  ${r.name}`);
  const st = spawnSync("git", ["status", "--short", "--", ...WRITTEN], { cwd: ROOT, encoding: "utf8" });
  console.log(`restamped files:\n${st.stdout.trim() || "  (none)"}`);
  const ratchets = results.filter((r) => r.name === "role-ratchet" || r.name === "dropped-clauses");
  console.log(`ratchet verdicts: ${ratchets.length ? ratchets.map((r) => `${r.name} ${r.code === 0 ? "ok" : "MOVED (exit " + r.code + ") -- explain, then bank by hand"}`).join("; ") : "not run"}`);
  if (failedStop) {
    console.log(`\nFAILED at step "${failedStop.name}". Fix it, then resume with: npm run derive:bump -- --restamp`);
    return 1;
  }
  return results.some((r) => r.code !== 0) ? 1 : 0;
}

process.exit(await main());
