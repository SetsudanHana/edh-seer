/** THE DECK-BUILD INSTRUMENT'S BOOKKEEPER. It never plays.
 *
 *  The four persona reviewers are READERS: they are handed screenshots of a finished report and
 *  asked what they make of it. None of them ever has to DO anything with the product. This run
 *  drives the site in a loop -- find a commander, collect cards from our pages, assemble a 99,
 *  paste it in, read the report, repair from its findings -- and the loop is the measurement.
 *  → `docs/superpowers/specs/2026-09-20-deck-build-agent-design.md`
 *
 *  A STATE MACHINE DRIVEN FROM OUTSIDE, and that is not a compromise. A script under `research/`
 *  cannot invoke a subagent, so the phases are run by whoever is holding the session and their
 *  results are handed back here. That is the shape the design asked for anyway: the harness holds
 *  the decklist between phases, enforces the cap and writes the record, and the agent does every
 *  single thing a player would do.
 *
 *    npx tsx research/web/deck-build-run.ts --self-test              # the pure maths, no browser
 *    npx tsx research/web/deck-build-run.ts init runs/deck-build.json
 *    npx tsx research/web/deck-build-run.ts build  runs/deck-build.json <phase.json>
 *    npx tsx research/web/deck-build-run.ts score  runs/deck-build.json <phase.json>
 *    npx tsx research/web/deck-build-run.ts repair runs/deck-build.json <phase.json>
 *    npx tsx research/web/deck-build-run.ts report runs/deck-build.json
 *
 *  `--self-test` RATHER THAN A `*.test.ts`, and the reason is mechanical: a test file under
 *  `research/` is collected by NO vitest project, so its coverage would be silently missing from
 *  `npm test` -- which is the direction `scripts/check_bin_placement.py` fails a build over.
 *  `ui-review-capture.ts` set this convention; this follows it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------------------------
// The shapes the phases hand back
// ---------------------------------------------------------------------------------------------

/** One navigation the agent made. `from` is how it GOT there, which is what separates a card the
 *  site offered from a card the agent went looking for. */
export type Visit = {
  url: string;
  /** `search` — typed into the header field or a browse filter. `link` — followed something the
   *  page listed. `direct` — typed a URL, which a player cannot do and an agent can. */
  from: "search" | "link" | "direct";
  /** What was typed, when `from` is `search`. */
  query?: string;
};

/** Where one card in the decklist came from. `url` is the page the agent saw the NAME on; `model`
 *  means it came from the agent's own knowledge, which is tallied and never discouraged. */
export type Citation = { name: string; source: string };

export type BuildPhase = { decklist: string[]; citations: Citation[]; trail: Visit[]; deadEnds?: string[] };
export type ScorePhase = {
  synergy?: number; build?: number; bracket?: string; legal?: boolean;
  findings: string[]; deadEnds?: string[];
};
export type RepairPhase = {
  changes: { card: string; action: "add" | "cut"; finding?: string }[];
  decklist: string[]; citations: Citation[]; trail: Visit[]; deadEnds?: string[];
};

export type Iteration = {
  n: number;
  build?: BuildPhase;
  score?: ScorePhase;
  repair?: RepairPhase;
};

export type Record_ = {
  commander: string;
  baseUrl: string;
  manifest: string;
  maxIterations: number;
  startedAt: string;
  iterations: Iteration[];
};

// ---------------------------------------------------------------------------------------------
// The maths, in Node, where it can be tested
// ---------------------------------------------------------------------------------------------

/** DISCOVERY OR CONFIRMATION, AND THE WHOLE MEASUREMENT TURNS ON IT.
 *
 *  The subtle failure is a TRUE citation attached to a FALSE claim. The agent already wants Sol
 *  Ring; it searches our site for "Sol Ring", lands on `/cards/sol-ring`, cites the URL. Nobody
 *  lied and the number means nothing -- the site CONFIRMED an idea it did not SUPPLY.
 *
 *  So a citation is `discovery` only when the page carrying that name was reached by FOLLOWING
 *  something the site listed. A page reached by searching for that same card's name is
 *  `confirmation`: a lookup, which is a legitimate product and is not what a partner list is for.
 *
 *  MATCHED AS A SLUG PREFIX, not as an exact string, and the self-test is what forced that: typing
 *  "krenko" and taking `/cards/krenko-mob-boss` off the listbox is obviously the agent going
 *  LOOKING for that card, and exact matching scored it as discovery. The site narrowed the name; it
 *  did not supply the idea.
 *
 *  A PREFIX AND NOT A SUBSTRING, deliberately. "ring" landing on `sol-ring` is a reader browsing by
 *  a word and being shown something -- that is the site offering, and it stays discovery. Three
 *  characters minimum, because a one- or two-letter query is a browse, not a name.
 *
 *  CEILING: the trail is reported by the agent, because only the agent drives the browser. The
 *  CLASSIFICATION is mechanical and cannot be talked around, but its input is self-reported. The
 *  guard is `invalidities` below: a citation naming a page that appears nowhere in the trail
 *  invalidates the run outright. */
export function citationKind(c: Citation, trail: Visit[]): "discovery" | "confirmation" | "model" {
  if (c.source === "model") return "model";
  // EVERY MATCH IS CONSIDERED, NOT THE FIRST. The same page can be reached twice -- offered by a
  // partner list, then searched for later -- and taking `find`'s first hit decided the number by
  // navigation order. If ANY visit to that page was a search for this card's own name, the site
  // confirmed rather than supplied it.
  const visits = trail.filter((v) => sameUrl(v.url, c.source));
  if (visits.length === 0) return "confirmation";
  return visits.some((v) => confirms(v, c.name)) ? "confirmation" : "discovery";
}

/** Did THIS visit confirm a name the agent already had?
 *
 *  A SEARCH WITH NO QUERY LOGGED COUNTS AS CONFIRMATION, and that is the conservative direction on
 *  purpose: `discovery` is the headline number, the one that says a partner list is a deckbuilding
 *  substrate, so a gap in the record must never inflate it. An agent that forgets to write down
 *  what it typed costs itself discovery rather than earning it. */
function confirms(v: Visit, cardName: string): boolean {
  // TYPING A CARD'S OWN URL IS THE PUREST CONFIRMATION THERE IS, and the first real run is what
  // showed it: an agent with browser tools does not click, it CONSTRUCTS urls, so 22 of 23 visits
  // came back `direct` and every one of them scored as discovery. A `direct` visit to a LIST page
  // (`/cards?produce=…`) is still discovery -- the agent built a query and the site answered it
  // with names it did not have -- but a `direct` visit to `/cards/<slug>` means it already knew
  // the name well enough to spell it.
  if (v.from === "direct") return detailSlug(v.url) === slug(cardName);
  if (v.from !== "search") return false;
  const q = slug(v.query ?? "");
  if (q.length === 0) return true;
  return q.length >= 3 && slug(cardName).startsWith(q);
}

/** The slug of a card or commander DETAIL page, or "" for a list, a browse letter or anything else
 *  that answers with names rather than being named. */
function detailSlug(url: string): string {
  const m = /\/(?:cards|commanders)\/([^/?#]+)/.exec(url);
  return m ? slug(decodeURIComponent(m[1]!)) : "";
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** THE SAME PAGE, however the round trip spelled it. A trailing slash, a `?ref=`, a `#anchor` --
 *  all benign browser artefacts, and comparing raw strings made every one of them a ghost citation
 *  that aborted the run. Origin and path only. */
export function sameUrl(a: string, b: string): boolean {
  const norm = (u: string): string => {
    try {
      const p = new URL(u);
      return `${p.origin}${p.pathname.replace(/\/+$/, "")}`.toLowerCase();
    } catch { return u.replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase(); }
  };
  return norm(a) === norm(b);
}

/** The split, over every citation in one phase. */
export function citationSplit(citations: Citation[], trail: Visit[]): Record<string, number> {
  const out = { discovery: 0, confirmation: 0, model: 0 };
  for (const c of citations) out[citationKind(c, trail)]++;
  return out;
}

/** CARDS THAT WENT IN, CAME OUT AND WENT BACK IN. A repair loop that oscillates averages into "no
 *  change" in a score column and is invisible; named here, it is a finding about whether our
 *  findings contradict each other. */
export function churn(iterations: Iteration[]): string[] {
  const history = new Map<string, ("add" | "cut")[]>();
  for (const it of iterations) {
    for (const ch of it.repair?.changes ?? []) {
      const seen = history.get(ch.card) ?? [];
      // Only a REVERSAL counts: add,add is the agent repeating itself, add,cut,add is churn.
      if (seen.at(-1) !== ch.action) seen.push(ch.action);
      history.set(ch.card, seen);
    }
  }
  return [...history.entries()].filter(([, a]) => a.length >= 3).map(([card]) => card).sort();
}

/** WHY THIS RUN CANNOT BE SCORED. Mirrors `.claude/agents/README.md`'s rules for a persona round,
 *  and for the same reason: a run that measured nothing must say so rather than produce a number
 *  nobody can interpret. */
export function invalidities(rec: Record_): string[] {
  const out: string[] = [];
  if (!rec.commander) out.push("no commander named in the run file — the run is not comparable");
  if (!rec.manifest) out.push("no deployed manifest version recorded — the run is not tied to a build");
  const trail = rec.iterations.flatMap((i) => [...(i.build?.trail ?? []), ...(i.repair?.trail ?? [])]);
  // A RUN WITH ITERATIONS BUT NO NAVIGATION IS THE FAILURE THIS CHECK EXISTS FOR, and the first cut
  // skipped it: `trail.length > 0` meant three score-only iterations carrying invented numbers and
  // zero site visits passed clean. An EMPTY run is excused (nothing has happened yet); a run that
  // recorded phases without ever opening a page is not.
  if (rec.iterations.length > 0 && !trail.some((v) => v.url.includes("/cards/"))) {
    out.push("the agent never opened a card page — it did not use the site");
  }
  const cited = rec.iterations.flatMap((i) => [...(i.build?.citations ?? []), ...(i.repair?.citations ?? [])]);
  const ghosts = [...new Set(cited
    .filter((c) => c.source !== "model" && !trail.some((v) => sameUrl(v.url, c.source)))
    .map((c) => c.name))];
  // THE GUARD ON THE SELF-REPORTED TRAIL. A citation naming a page the trail never visited is not
  // a scoring judgement to make later -- it means the two halves of the report disagree, and the
  // run cannot be trusted at all.
  if (ghosts.length > 0) out.push(`${ghosts.length} citation(s) name a page the trail never visited: ${ghosts.slice(0, 5).join(", ")}`);
  return out;
}

/** A deck is 100 cards in Commander: the commander plus 99. Counted rather than assumed, because a
 *  build phase that hands back 87 lines is a phase that failed quietly. */
export function deckSizeProblem(decklist: string[]): string | undefined {
  // COUNTED AS CARDS, NOT AS LINES. "4 Island" is four cards, and counting lines called a legal
  // 99 a 93 on the very first real run -- a warning that cries wolf on a correct deck is worse
  // than no warning, because the next one gets ignored too.
  const n = decklist.reduce((sum, line) => sum + (Number(/^\s*(\d+)/.exec(line)?.[1] ?? 1) || 1), 0);
  return n === 99 ? undefined : `decklist has ${n} cards, expected 99 beside the commander`;
}

// ---------------------------------------------------------------------------------------------
// The record on disk
// ---------------------------------------------------------------------------------------------

const RECORD = (out: string): string => join(out, "record.json");

function load(out: string): Record_ {
  const p = RECORD(out);
  if (!existsSync(p)) throw new Error(`no run in ${out} — run \`init\` first`);
  return JSON.parse(readFileSync(p, "utf8")) as Record_;
}

function save(out: string, rec: Record_): void {
  mkdirSync(dirname(RECORD(out)), { recursive: true });
  writeFileSync(RECORD(out), `${JSON.stringify(rec, null, 2)}\n`);
}

/** The iteration a phase belongs to: the last one still missing that phase, or a new one. The cap
 *  is enforced here rather than trusted to whoever is driving. */
const NEEDS_FIRST: Record<string, "build" | "score" | undefined> = { score: "build", repair: "score" };

function slotFor(rec: Record_, phase: "build" | "score" | "repair"): Iteration {
  const open = rec.iterations.find((i) => i[phase] === undefined);
  if (open) {
    // IN ORDER, WITHIN AN ITERATION. `find` alone attached a phase to the first slot missing it,
    // so a `repair` sent before its `score` landed on an iteration that had not been scored --
    // misattributing which round a change belonged to, which is the one thing the per-iteration
    // table exists to get right.
    const needs = NEEDS_FIRST[phase];
    if (needs && open[needs] === undefined) {
      throw new Error(`iteration ${open.n} has no ${needs} yet — phases go build, score, repair`);
    }
    return open;
  }
  // AND A NEW ITERATION MAY ONLY BE OPENED BY A BUILD. The ordering check above lives on the
  // "found an open slot" branch, so a `repair` arriving with no iterations at all created one and
  // walked straight past it -- the guard was there and the path around it was not. Proven by
  // running it, not by reading it.
  if (phase !== "build") {
    throw new Error(`nothing to ${phase}: no open iteration needs it — phases go build, score, repair`);
  }
  if (rec.iterations.length >= rec.maxIterations) {
    throw new Error(`iteration cap reached (${rec.maxIterations}) — three is the smallest number that shows a TREND, so stop here and read the record`);
  }
  const next: Iteration = { n: rec.iterations.length + 1 };
  rec.iterations.push(next);
  return next;
}

// ---------------------------------------------------------------------------------------------
// self-test: the pure maths, no browser
// ---------------------------------------------------------------------------------------------

function selfTest(): void {
  const eq = (got: unknown, want: unknown, what: string): void => {
    const a = JSON.stringify(got), b = JSON.stringify(want);
    if (a !== b) { console.error(`FAIL ${what}\n  got  ${a}\n  want ${b}`); process.exitCode = 1; }
    else console.log(`ok   ${what}`);
  };

  // THE MEASUREMENT, AND THEREFORE THE TEST THAT MOST NEEDS TO BE WATCHED FAILING.
  const trail: Visit[] = [
    { url: "https://e/commanders/inalla", from: "link" },
    { url: "https://e/cards/sol-ring", from: "search", query: "Sol Ring" },
    { url: "https://e/cards/skullclamp", from: "link" },
    { url: "https://e/cards/krenko-mob-boss", from: "search", query: "krenko" },
  ];
  eq(citationKind({ name: "Sol Ring", source: "https://e/cards/sol-ring" }, trail), "confirmation",
    "a page reached by searching the card's own name is CONFIRMATION");
  eq(citationKind({ name: "Skullclamp", source: "https://e/cards/skullclamp" }, trail), "discovery",
    "a page reached by following a link is DISCOVERY");
  eq(citationKind({ name: "Krenko, Mob Boss", source: "https://e/cards/krenko-mob-boss" }, trail), "confirmation",
    "a partial-name search for the card still CONFIRMS");
  eq(citationKind({ name: "Goblin Matron", source: "https://e/cards/krenko-mob-boss" }, trail), "discovery",
    "a card LISTED on a page someone searched for is still DISCOVERY");
  // A PREFIX, NOT A SUBSTRING: browsing by a word and being shown something is the site offering.
  eq(citationKind({ name: "Sol Ring", source: "https://e/cards/ring-hunt" }, [
    { url: "https://e/cards/ring-hunt", from: "search", query: "ring" }]), "discovery",
    "a query that is not a PREFIX of the name is a browse, so it stays DISCOVERY");
  eq(citationKind({ name: "Ancient Tomb", source: "https://e/cards/ancient-tomb" }, [
    { url: "https://e/cards/ancient-tomb", from: "search", query: "an" }]), "discovery",
    "a two-letter query is a browse, never a name");
  eq(citationKind({ name: "Lightning Bolt", source: "model" }, trail), "model",
    "the agent's own knowledge is tallied, never discouraged");
  eq(citationSplit([
    { name: "Sol Ring", source: "https://e/cards/sol-ring" },
    { name: "Skullclamp", source: "https://e/cards/skullclamp" },
    { name: "Lightning Bolt", source: "model" },
  ], trail), { discovery: 1, confirmation: 1, model: 1 }, "the split counts all three kinds");

  // CHURN: a reversal, not a repetition.
  eq(churn([
    { n: 1, repair: { changes: [{ card: "A", action: "add" }, { card: "B", action: "add" }], decklist: [], citations: [], trail: [] } },
    { n: 2, repair: { changes: [{ card: "A", action: "cut" }], decklist: [], citations: [], trail: [] } },
    { n: 3, repair: { changes: [{ card: "A", action: "add" }, { card: "B", action: "add" }], decklist: [], citations: [], trail: [] } },
  ]), ["A"], "added, cut, re-added is churn; added twice is not");

  // VALIDITY, both directions.
  const base: Record_ = {
    commander: "Inalla", baseUrl: "https://e", manifest: "v-1", maxIterations: 3,
    startedAt: "now", iterations: [],
  };
  eq(invalidities(base), [], "an empty run is not yet invalid — it has simply not measured anything");
  eq(invalidities({ ...base, commander: "" }).length, 1, "no commander invalidates the run");
  eq(invalidities({ ...base, manifest: "" }).length, 1, "no manifest version invalidates the run");
  eq(invalidities({
    ...base,
    iterations: [{ n: 1, build: { decklist: [], citations: [], trail: [{ url: "https://e/commanders/inalla", from: "link" }] } }],
  }), ["the agent never opened a card page — it did not use the site"],
    "a trail that never reached a card page invalidates the run");
  eq(invalidities({
    ...base,
    iterations: [{ n: 1, build: {
      decklist: [], trail: [{ url: "https://e/cards/sol-ring", from: "link" }],
      citations: [{ name: "Skullclamp", source: "https://e/cards/skullclamp" }],
    } }],
  }).length, 1, "a citation naming a page the trail never visited invalidates the run");

  // EVERY CASE BELOW IS ONE THE FIRST SELF-TEST MISSED AND A REVIEW CAUGHT. They are the cheap
  // half of the lesson: the maths was right for the inputs it had been shown.
  eq(citationKind({ name: "Sol Ring", source: "https://e/cards/sol-ring/" }, [
    { url: "https://e/cards/sol-ring", from: "link" }]), "discovery",
    "a trailing slash is the same page, not a ghost citation");
  eq(citationKind({ name: "Sol Ring", source: "https://e/cards/sol-ring?ref=x#top" }, [
    { url: "https://e/cards/sol-ring", from: "link" }]), "discovery",
    "a query string and an anchor are the same page");
  eq(citationKind({ name: "Sol Ring", source: "https://e/cards/sol-ring" }, [
    { url: "https://e/cards/sol-ring", from: "link" },
    { url: "https://e/cards/sol-ring", from: "search", query: "sol ring" }]), "confirmation",
    "a page both linked to AND searched for resolves CONFIRMATION, not by navigation order");
  eq(citationKind({ name: "Sol Ring", source: "https://e/cards/sol-ring" }, [
    { url: "https://e/cards/sol-ring", from: "search" }]), "confirmation",
    "a search with no query logged counts against discovery, never for it");
  eq(invalidities({
    ...base,
    iterations: [{ n: 1, score: { findings: ["invented"], synergy: 5 } }],
  }), ["the agent never opened a card page — it did not use the site"],
    "score-only iterations with no navigation cannot pass as a valid run");

  // ORDERING, INCLUDING THE PATH AROUND THE GUARD. The check lived on the "found an open slot"
  // branch, so a phase arriving with NO iterations created one and walked past it.
  const threw = (fn: () => unknown): string => { try { fn(); return ""; } catch (e) { return (e as Error).message; } };
  const fresh = (): Record_ => ({ ...base, iterations: [] });
  eq(threw(() => slotFor(fresh(), "score")).includes("nothing to score"), true,
    "a score with no iterations at all is refused, not given a fresh one");
  eq(threw(() => slotFor(fresh(), "repair")).includes("nothing to repair"), true,
    "a repair with no iterations at all is refused");
  eq(threw(() => slotFor(fresh(), "build")), "", "a build opens the iteration");
  const built: Record_ = { ...base, iterations: [{ n: 1, build: { decklist: [], citations: [], trail: [] } }] };
  eq(threw(() => slotFor(built, "repair")).includes("has no score yet"), true,
    "a repair before its score is refused");
  eq(threw(() => slotFor({ ...base, maxIterations: 1, iterations: [
    { n: 1, build: { decklist: [], citations: [], trail: [] }, score: { findings: [] },
      repair: { changes: [], decklist: [], citations: [], trail: [] } }] }, "build")).includes("cap reached"), true,
    "the iteration cap cannot be walked past");

  eq(deckSizeProblem(Array.from({ length: 99 }, (_, i) => `c${i}`)), undefined, "99 cards is a deck");
  eq(typeof deckSizeProblem(["one"]), "string", "any other count is a phase that failed quietly");
  // FOUND BY THE FIRST REAL RUN: basics arrive with a count and 90 lines can be 99 cards.
  eq(deckSizeProblem([...Array.from({ length: 90 }, (_, i) => `1 c${i}`), "4 Island", "3 Swamp", "2 Mountain"]),
    undefined, "a line carrying a count is that many cards, not one");
  eq(citationKind({ name: "Naru Meha, Master Wizard", source: "https://e/cards/naru-meha-master-wizard" }, [
    { url: "https://e/cards/naru-meha-master-wizard", from: "direct" }]), "confirmation",
    "typing a card's OWN url is confirmation, however the agent got there");
  eq(citationKind({ name: "Viscera Seer", source: "https://e/cards?produce=fodder&colors=UBR" }, [
    { url: "https://e/cards?produce=fodder&colors=UBR", from: "direct" }]), "discovery",
    "typing a LIST url and reading the names off it is still discovery");

  console.log(process.exitCode ? "\nself-test FAILED" : "\nself-test passed");
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "--self-test") return selfTest();

  if (cmd === "init") {
    if (!arg) throw new Error("usage: init <run-file.json>");
    const run = JSON.parse(readFileSync(arg, "utf8")) as
      { commander: string; baseUrl: string; out: string; maxIterations?: number };
    // THE DEPLOYED VERSION, READ NOW. A run whose iterations straddle a deploy measured two
    // different sites, and the stale-artifact trap of 2026-09-05 is exactly this shape.
    // A RUN IN PROGRESS IS NOT RE-INITIALISED. `init` wrote unconditionally, so running it twice
    // wiped the record and with it the iteration count -- which silently resets the cap that exists
    // to stop a loop being read as a trend when it is a grind.
    if (existsSync(RECORD(run.out))) {
      throw new Error(`a run already exists at ${RECORD(run.out)} — delete it to start over, `
        + "or report on it; init will not overwrite an iteration count.");
    }
    const res = await fetch(`${run.baseUrl}/static/manifest.json`);
    if (!res.ok) throw new Error(`${run.baseUrl}/static/manifest.json answered ${res.status}`);
    // READ AS TEXT AND PARSED HERE, so an SPA fallback serving 200-and-HTML says what it was rather
    // than throwing an unexplained SyntaxError out of top-level await.
    const body = await res.text();
    let manifest: string;
    try {
      manifest = (JSON.parse(body) as { version?: string }).version ?? "";
    } catch {
      throw new Error(`${run.baseUrl}/static/manifest.json did not return JSON (got ${body.slice(0, 60)}…)`);
    }
    if (!manifest) throw new Error(`${run.baseUrl}/static/manifest.json has no "version" — cannot tie the run to a build`);
    const rec: Record_ = {
      commander: run.commander, baseUrl: run.baseUrl, manifest,
      maxIterations: run.maxIterations ?? 3, startedAt: new Date().toISOString(), iterations: [],
    };
    save(run.out, rec);
    console.log(`run started: ${rec.commander} against ${rec.baseUrl} at ${manifest}`);
    console.log(`cap ${rec.maxIterations} iterations · record ${RECORD(run.out)}`);
    return;
  }

  // EVERY COMMAND TAKES THE RUN FILE, and the first cut did not: `init` wrote to the run file's
  // `out` while the phase commands defaulted to a parent directory, so a phase silently looked for
  // a record that was one level up and absent. Caught by running it rather than by reading it.
  // Explicit beats an environment variable here -- the run file already names the directory, and a
  // second place to say it is a second place for the two to disagree.
  const runFileOf = (a?: string): string => {
    if (!a) throw new Error(`usage: ${cmd} <run-file.json> <phase.json>`);
    return (JSON.parse(readFileSync(a, "utf8")) as { out: string }).out;
  };
  if (cmd === "build" || cmd === "score" || cmd === "repair") {
    const phaseFile = process.argv[4];
    if (!phaseFile) throw new Error(`usage: ${cmd} <run-file.json> <phase.json>`);
    const out = runFileOf(arg);
    const rec = load(out);
    const slot = slotFor(rec, cmd);
    const payload = JSON.parse(readFileSync(phaseFile, "utf8"));
    (slot as Record<string, unknown>)[cmd] = payload;
    save(out, rec);
    if (cmd !== "score") {
      const p = payload as BuildPhase | RepairPhase;
      const problem = deckSizeProblem(p.decklist);
      if (problem) console.log(`  WARNING: ${problem}`);
      console.log(`  citations: ${JSON.stringify(citationSplit(p.citations, p.trail))}`);
    }
    console.log(`iteration ${slot.n}: ${cmd} recorded`);
    return;
  }

  if (cmd === "report") {
    const rec = load(runFileOf(arg));
    console.log(`${rec.commander} · ${rec.baseUrl} · ${rec.manifest} · started ${rec.startedAt}`);
    const bad = invalidities(rec);
    if (bad.length > 0) {
      console.log("\nTHIS RUN CANNOT BE SCORED:");
      for (const b of bad) console.log(`  - ${b}`);
      // AND THE TABLE IS NOT PRINTED. The first cut printed the invalidity and then the numbers
      // anyway, which is worse than printing nothing: a reader who scrolls past the warning, or
      // greps the output, gets a quotable figure out of a run the instrument has just declared
      // unscoreable. A refusal that still hands over the number is not a refusal.
      console.log("\nno table printed — fix the run and re-read it.");
      process.exitCode = 1;
      return;
    }
    // ONE WIDTH LIST FOR THE HEADER AND THE ROWS. The first cut padded them separately and the
    // columns did not line up -- a table a reader has to count spaces in is a table they misread.
    const COLS = [
      ["iter", 4], ["discovery", 10], ["confirm", 9], ["model", 7],
      ["synergy", 9], ["build", 7], ["findings", 10], ["changes", 9], ["unmotivated", 13],
    ] as const;
    console.log(`\n${COLS.map(([h, w]) => h.padStart(w)).join("")}`);
    for (const it of rec.iterations) {
      const cites = [...(it.build?.citations ?? []), ...(it.repair?.citations ?? [])];
      const trail = [...(it.build?.trail ?? []), ...(it.repair?.trail ?? [])];
      const s = citationSplit(cites, trail);
      const ch = it.repair?.changes ?? [];
      const cells = [
        it.n, s.discovery, s.confirmation, s.model,
        it.score?.synergy ?? "-", it.score?.build ?? "-", it.score?.findings.length ?? "-",
        ch.length, ch.filter((c) => !c.finding).length,
      ];
      console.log(cells.map((c, i) => String(c).padStart(COLS[i]![1])).join(""));
    }
    const c = churn(rec.iterations);
    if (c.length > 0) console.log(`\nchurn (added, cut, re-added): ${c.join(", ")}`);
    const dead = rec.iterations.flatMap((i) => [
      ...(i.build?.deadEnds ?? []), ...(i.score?.deadEnds ?? []), ...(i.repair?.deadEnds ?? []),
    ]);
    if (dead.length > 0) {
      console.log(`\nthe site could not answer (${dead.length}):`);
      for (const d of dead) console.log(`  - ${d}`);
    }
    // THE FIRST RUN IS CALIBRATION, NOT A RESULT. An all-confirmation split means either the
    // classifier is mislabelling or the site never surfaced a card the agent did not already want,
    // and those two are indistinguishable in a record -- so the record says so out loud.
    const all = citationSplit(
      rec.iterations.flatMap((i) => [...(i.build?.citations ?? []), ...(i.repair?.citations ?? [])]),
      rec.iterations.flatMap((i) => [...(i.build?.trail ?? []), ...(i.repair?.trail ?? [])]),
    );
    if (all.discovery === 0 && all.confirmation > 0) {
      console.log("\nCALIBRATION: zero discovery. Either the classifier is mislabelling or the site"
        + "\nnever offered a card the agent did not already want. Those are indistinguishable here"
        + "\n-- check the trail by hand before quoting any number from this run.");
    }
    return;
  }

  console.error("usage: deck-build-run.ts --self-test | init <run.json>"
    + " | build|score|repair <run.json> <phase.json> | report <run.json>");
  process.exitCode = 2;
}

// A REFUSAL IS A MESSAGE, NOT A STACK TRACE. Every throw above is a thing the operator did that
// the harness will not do -- clobbering a live run, sending a phase out of order, passing the cap
// -- and printing Node's stack for those buries the sentence that says what to do instead.
try {
  await main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
