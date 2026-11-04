#!/usr/bin/env node
/** `npm run ci:local` -- every `run:` step of the `test` job in .github/workflows/ci.yml, in CI's
 *  order, stopping at the first failure and naming it (#1483).
 *
 *  Two CI-only failures on #1479 each cost a full round because the "four gates" were not every
 *  step. The step list is READ from ci.yml, never copied, so the two cannot drift; `npm ci` is the
 *  one step skipped (you have node_modules). MONGO_TEST_URI defaults to the local container, as CI's
 *  service does, so the database suites run instead of skipping.
 *
 *  ADVISORY LAST STEP: `lint:redos` runs after the ci.yml steps and only WARNS. The scanner reads
 *  regex literals and has no data flow, while CodeQL's js/polynomial-redos alerts only on regexes
 *  applied to library input, so a hit may be a regex CodeQL accepts. CodeQL stays the gate; judge each
 *  hit. `npm run lint:redos` on its own is strict (exit 1). Its self-test still blocks here.
 *
 *  Run: node scripts/ci_local.mjs [--self-test | --list]. Node built-ins only. */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = process.env.CI_LOCAL_WORKFLOW || resolve(ROOT, ".github", "workflows", "ci.yml"); // the override is for trying a temp workflow

/** The steps of the `test` job, minus the install: `{ cmd, env, block }` each.
 *
 *  EVERY `run:` key in the job is either executed as CI runs it or refused loudly (throws). Handled:
 *  `- run: cmd`, a name-first step (`run:` a later key of the same `- ` item), `run: |` / `run: >`
 *  blocks (the indented block; a `|` block runs under `bash -e -c`), and a step-level `env:` map that
 *  applies to its own step only. Refused: quoted or `${{ }}` values. The count of `run:` keys is
 *  compared with the count parsed, so a form this reader does not understand cannot drop a step. */
export function parseSteps(yaml) {
  const lines = [];
  let inJob = false;
  for (const line of yaml.split("\n")) {
    const job = line.match(/^ {2}([A-Za-z_][\w-]*):\s*$/);
    if (job) inJob = job[1] === "test";
    if (inJob) lines.push(line);
  }
  const indentOf = (l) => l.length - l.trimStart().length;
  const steps = [];
  for (let i = 0; i < lines.length; i++) {
    const dash = lines[i].match(/^(\s*)- /);
    if (!dash) continue;
    const base = dash[1].length;
    let end = i + 1;
    while (end < lines.length && (lines[end].trim() === "" || indentOf(lines[end]) > base)) end++;
    const item = lines.slice(i, end);
    item[0] = " ".repeat(base + 2) + item[0].slice(base + 2); // the `- ` becomes key indentation
    const key = base + 2;
    let cmd = null, block = false, env = {};
    for (let j = 0; j < item.length; j++) {
      const l = item[j];
      if (l.trim() === "" || indentOf(l) !== key) continue;
      const run = l.trim().match(/^run:\s*(.*?)\s*$/);
      if (run) {
        const v = run[1];
        if (/^[|>][+-]?$/.test(v)) {
          const body = [];
          for (let k = j + 1; k < item.length && (item[k].trim() === "" || indentOf(item[k]) > key); k++) body.push(item[k]);
          const w = Math.min(...body.filter((x) => x.trim()).map(indentOf));
          const text = body.map((x) => x.slice(w)).join(v[0] === "|" ? "\n" : " ").trim();
          cmd = text; block = v[0] === "|";
        } else if (!v || /^["']/.test(v) || v.includes("${{")) {
          throw new Error(`ci:local cannot read this run: value (${JSON.stringify(v)}) on ci.yml line ${i + 1} of the test job; refusing rather than skipping it`);
        } else cmd = v;
      } else if (/^env:\s*$/.test(l.trim())) {
        for (let k = j + 1; k < item.length && (item[k].trim() === "" || indentOf(item[k]) > key); k++) {
          const kv = item[k].trim().match(/^([A-Za-z_]\w*):\s*(.*)$/);
          if (kv) {
            if (kv[2].includes("${{")) throw new Error(`ci:local cannot expand ${kv[2]} in env ${kv[1]}`);
            env[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
          }
        }
      }
    }
    if (cmd !== null && cmd !== "npm ci") steps.push({ cmd, env, block });
    else if (cmd === null && item.some((x) => /^\s*run:/.test(x))) throw new Error("ci:local could not read a run: step");
  }
  const runValue = (l) => { let t = l.trimStart(); if (t.startsWith("- ")) t = t.slice(2); return t.startsWith("run:") ? t.slice(4).trim() : null; };
  const keys = lines.filter((l) => runValue(l) !== null).length;
  const installs = lines.filter((l) => runValue(l) === "npm ci").length;
  if (keys !== steps.length + installs) throw new Error(`ci:local read ${steps.length + installs} of ${keys} run: keys in the test job; refusing to run a partial list`);
  return steps;
}

function selfTest() {
  const must = (ok, m) => { if (!ok) throw new Error(`self-test failed: ${m}`); };
  const sample = "jobs:\n  test:\n    steps:\n      - run: npm ci\n      # c\n      - run: npm run a && b\n  next:\n    steps:\n      - run: npm run other\n";
  const got = parseSteps(sample);
  must(got.length === 1 && got[0].cmd === "npm run a && b", "only the test job's steps, without npm ci");
  const rich = [
    "  test:", "    steps:",
    "      - uses: x/y@1", "        with:", "          a: b",
    "      - name: Name first", "        run: npm run lint:x",
    "      - name: Block", "        run: |", "          echo one", "          echo two", "      - run: npm test", "        env:", "          MONGO_TEST_URI: mongodb://h:1",
    "  next:", "    steps:", "      - run: nope", "",
  ].join("\n");
  const r = parseSteps(rich);
  must(r.length === 3, `rich sample parsed ${r.length} steps`);
  must(r[0].cmd === "npm run lint:x", "a name-first step is read");
  must(r[1].cmd === "echo one\necho two" && r[1].block, "a run: | block is read whole");
  must(r[2].cmd === "npm test" && r[2].env.MONGO_TEST_URI === "mongodb://h:1" && !r[0].env.MONGO_TEST_URI, "env belongs to its own step");
  let refused = false;
  try { parseSteps("  test:\n    steps:\n      - run: \"quoted\"\n"); } catch { refused = true; }
  must(refused, "a value it cannot read is refused, not skipped");
  const real = parseSteps(readFileSync(WORKFLOW, "utf8")).map((x) => x.cmd);
  must(!real.includes("npm run lint:redos"), "lint:redos is advisory and local-only; ci.yml must not run it");
  for (const need of ["npm run typecheck", "npm test", "npm run lint:bins", "npm run lint:ceilings", "npm run lint"]) {
    must(real.includes(need), `ci.yml's test job no longer runs \`${need}\``);
  }
  console.log(`self-test: ${real.length} steps read from ci.yml`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) { selfTest(); return 0; }
  const steps = parseSteps(readFileSync(WORKFLOW, "utf8"));
  if (args.includes("--list")) { console.log(steps.map((x) => x.cmd).join("\n")); return 0; }
  const t0 = Date.now();
  for (const [i, step] of steps.entries()) {
    const { cmd } = step;
    // A step's own env only; MONGO_TEST_URI may be overridden from the shell, else CI's service URL
    // (the local container is on the same port).
    const env = { ...process.env, ...step.env };
    if ("MONGO_TEST_URI" in step.env) env.MONGO_TEST_URI = process.env.MONGO_TEST_URI || step.env.MONGO_TEST_URI;
    const spawnArgs = step.block ? ["bash", ["-e", "-c", cmd], { cwd: ROOT, env, stdio: "inherit" }] : [cmd, { cwd: ROOT, env, shell: true, stdio: "inherit" }];
    console.log(`\n=== ci:local ${i + 1}/${steps.length}: ${cmd}`);
    const t = Date.now();
    const r = spawnSync(...spawnArgs);
    const code = r.status ?? 1;
    console.log(`=== exit ${code} in ${((Date.now() - t) / 1000).toFixed(1)}s: ${cmd}`);
    if (code !== 0) { console.log(`\nci:local FAILED at step ${i + 1}/${steps.length}: ${cmd}`); return code; }
  }
  const scan = (a) => spawnSync("node", ["scripts/check_regex_shapes.mjs", ...a], { cwd: ROOT, encoding: "utf8" });
  const self = scan(["--self-test"]);
  if (self.status !== 0) { process.stdout.write(self.stdout + self.stderr); console.log("\nci:local FAILED: lint:redos self-test (a broken scanner must fail)"); return self.status ?? 1; }
  const found = scan([]);
  process.stdout.write(found.stdout + found.stderr);
  const n = (found.stdout.match(/^\S+:\d+: /gm) ?? []).length;
  if (found.status === 0) console.log("\nlint:redos: 0 CodeQL-shape warnings in added lines");
  else if (n === 0) console.log(`\nlint:redos could not run: ${(found.stderr.split("\n")[0] || `exit ${found.status}`)}`);
  else {
    console.log(`\nlint:redos: ${n} CodeQL-shape warning(s) in added lines \u2014 judge each (CodeQL fails the PR on a real one)`);
  }
  console.log(`\nci:local: all ${steps.length} steps passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return 0;
}

try { process.exitCode = main(); } catch (e) { console.error(String(e.message ?? e)); process.exitCode = 1; }
