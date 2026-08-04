/** Tests the slot-filling normalizer against the acceptance gates, BEFORE committing to a re-tag.
 *
 *  The card is segmented mechanically first, and the model is handed a numbered clause list it must
 *  answer one-for-one. It cannot merge, split or drop — the freedom that made two identical runs
 *  disagree on 45% of cards. Every field is a closed vocabulary; only `object` is free text.
 *
 *  Runs twice on the same cards and scores:
 *    DETERMINISM   — structured skeleton identical across runs (baseline today 55%, gate 90%)
 *    COMPLETENESS  — every clause id answered, none invented (gate: 100%)
 *    KNOWN-WRONG   — the four cards today's tagger gets wrong come out right
 *
 *  Usage: tsx src/bin/normalize-experiment.ts [outDir]   (needs ANTHROPIC_API_KEY) */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect, loadConfig } from "@mtg/data";
import { loadTaggerConfig } from "../config.js";
import { createProvider } from "../llm/factory.js";
import { segment, type Clause } from "../segment.js";

const OUT = process.argv[2] ?? "/tmp/normalize-exp";
/** `--random N seed` draws a HELD-OUT sample instead of the curated list below. The curated cards
 *  were chosen because they were broken and the prompt was then tuned against them, so they cannot
 *  demonstrate generalisation — only a fresh draw can. The curated 20 are excluded from it. */
/** `--filter <regex>` restricts the draw by type line, so a sample can be aimed at the shapes a
 *  change actually touched — a random 100 contains only a handful of planeswalkers or Sagas. */
const filterIdx = process.argv.indexOf("--filter");
const TYPE_FILTER = filterIdx > 0 ? new RegExp(process.argv[filterIdx + 1], "i") : null;
const randIdx = process.argv.indexOf("--random");
const RANDOM_N = randIdx > 0 ? Number(process.argv[randIdx + 1] ?? 20) : 0;
const RANDOM_SEED = randIdx > 0 ? Number(process.argv[randIdx + 2] ?? 11) : 11;

const CARDS = [
  "Bitterblossom", "Kura, the Boundless Sky", "Cultivate", "Path to Exile", "Swiftfoot Boots",
  "Counterspell", "Supreme Verdict", "Phyrexian Tower", "Sen Triplets", "Heritage Reclamation",
  "Balan, Wandering Knight", "Feeling of Dread", "Crystalline Giant", "The Elderspell",
  "Nervous Gardener", "Contaminated Drink", "Innkeeper's Talent", "Urza's Saga",
  "Yarok, the Desecrated", "Riverglide Pathway // Lavaglide Pathway",
];

const VERBS = ["destroy", "exile", "sacrifice", "tap", "untap", "draw", "discard", "mill", "search",
  "put", "return", "create", "counter-spell", "copy", "gain-life", "lose-life", "deal-damage",
  "add-mana", "add-counter", "remove-counter", "grant-ability", "modify-pt", "prevent", "cast",
  "play", "shuffle", "reveal", "attach", "transform", "trigger-again", "extra-turn", "extra-combat",
  "animate", "cant", "other", "none"];
const ZONES = ["battlefield", "graveyard", "hand", "library", "exile", "stack", "command"];
const TRIGGERS = ["enters", "dies", "leaves", "attacks", "blocks", "taps", "untaps", "cast",
  "upkeep", "begin-combat", "end-step", "draw-step", "main-phase", "combat-damage-step", "damage-dealt", "life-gained", "life-lost",
  "counter-added", "sacrificed", "discarded", "milled", "turned-face-up", "level-up", "chapter",
  "none"];

const SYSTEM = `You NORMALIZE Magic: The Gathering rules text. You do not classify, rate, or interpret it.

You are given a card's clauses, already numbered. Answer EVERY clause id exactly once, in order.
Never merge clauses, never split one, never invent an id.

The clause list already carries type= and cost= where they apply. Do NOT re-decide them; copy
type= into abilityType verbatim.

For each clause return:
{ "id": number,
  "abilityType": copied from type=, or "none" for keyword/reminder clauses,
  "trigger": { "event": TriggerEvent, "subject": string, "control": "you"|"opponent"|"any" },  // omit if not triggered
  "actions": [ { "verb": Verb, "object": string, "fromZone": Zone|null, "toZone": Zone|null,
                 "amount": string|null, "optional": boolean } ] }

Verb is EXACTLY one of: ${VERBS.join(", ")}
Zone is EXACTLY one of: ${ZONES.join(", ")}
TriggerEvent is EXACTLY one of: ${TRIGGERS.filter((t) => t !== "none").join(", ")}

Rules:
- Record what the clause SAYS. "Destroy target creature" is verb "destroy" — never a category
  like "removal" and never a strategic label.
- fromZone/toZone are set ONLY when the clause MOVES an object between zones. Getting this right
  matters more than anything else: "search your library ... put it onto the battlefield" is
  library->battlefield, but "... put it into your hand" is library->hand. They are different cards.
- Every clause you are shown states a game action; inert clauses are not sent to you.
- OMIT the trigger field entirely when the clause is not triggered. Do not send trigger:null and
  do not send event:"none" — one fact must have exactly one encoding, or two runs disagree over
  nothing. (This ambiguity alone accounted for every residual disagreement in the first run.)
- "trigger-again" is for effects that make a triggered ability trigger an additional time.
- COSTS are already decided for you. A clause showing costActions=[...] contributes exactly those
  actions FIRST, verbatim, then the actions of its effect. A clause with a cost= but no
  costActions contributes none from the cost — paying mana and tapping the source are not things
  any card triggers on. Never infer a cost action yourself.
- ZONES. Set fromZone/toZone for EXACTLY these five verbs and no others: put, return, exile,
  search, cast. Their zones genuinely vary — "put onto the battlefield" and "put into your hand"
  are different cards. Every other verb already fixes its own zones: a draw is always
  library->hand, a mill always library->graveyard, a discard always hand->graveyard, a sacrifice
  always battlefield->graveyard. Recording those makes two runs disagree over a fact neither
  chose. Leave them null.
  Those verbs already imply where they happen; recording it twice makes two runs disagree over
  nothing. "create" is the one exception you may be tempted by — a token entering is implied by
  the verb, so leave its zones null.
- "Enters tapped" is a property of entering, not an action: record it as verb "tap" with object
  "this", so the fact survives without inventing a second entry event.
- List one action per game action the clause states, in the order written.
- "cant" is for restrictions ("can't attack", "can't be countered"); put the restriction in object.
- "animate" is a permanent BECOMING a creature ("becomes a 0/0 Elemental creature", man-lands,
  Ensoul Artifact). Do not reach for transform, modify-pt or grant-ability for this — transform is
  only for a double-faced card turning over.
- "put a counter on" is ALWAYS add-counter, never put. The verb "put" is exclusively for moving an
  object between zones ("put it onto the battlefield", "put it into your hand").
- Three pairs that have been observed swapping; the rule for each:
  * A COUNTER of any kind (+1/+1, loyalty, lore, indestructible, stun) is always add-counter with
    the kind in object — never "other", even for an unusual counter.
  * "becomes a creature" is animate. "transform" is ONLY a double-faced card turning over.
  * An effect that makes an ability trigger an extra time is trigger-again; an effect that makes a
    TOKEN is create. Copying a permanent is copy. These are three different things.
- "other" is the deliberate escape hatch: when a clause does something no verb above covers
  (changing maximum hand size, an unusual rules modification), use verb "other" and put the effect
  verbatim in object. Use it rather than forcing a near-miss verb — a wrong verb is consumed as if
  it were true, while "other" is honestly inert.
Return ONLY { "clauses": [ ... ] }.`;

const s = await connect(loadConfig());
const cfg = loadTaggerConfig();
const provider = createProvider({ ...cfg, maxTokens: 3000 });
mkdirSync(OUT, { recursive: true });

let cardNames: string[] = CARDS;
if (RANDOM_N > 0) {
  const query: Record<string, unknown> = { oracleText: { $exists: true, $ne: "" }, edhrecRank: { $lte: 15000 } };
  if (TYPE_FILTER) query.typeLine = { $regex: TYPE_FILTER.source, $options: "i" };
  const pool = (await s.db.collection("cards")
    .find(query, { projection: { name: 1 } }).toArray()) as unknown as { name: string }[];
  const curated = new Set(CARDS);
  const eligible = pool.map((p) => p.name).filter((n) => !curated.has(n)).sort();
  if (TYPE_FILTER) console.log(`type filter /${TYPE_FILTER.source}/ matched ${eligible.length} cards`);
  let x = RANDOM_SEED;
  const rnd = (): number => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; };
  for (let i = eligible.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [eligible[i], eligible[j]] = [eligible[j], eligible[i]]; }
  cardNames = eligible.slice(0, RANDOM_N);
  console.log(`HELD-OUT sample of ${cardNames.length} (seed ${RANDOM_SEED}), curated cards excluded:`);
  console.log("  " + cardNames.join(", ") + "\n");
}

const prepared: { name: string; clauses: Clause[] }[] = [];
for (const name of cardNames) {
  const c = (await s.db.collection("cards").findOne({ name })) as
    { name: string; oracleText?: string; keywords?: string[]; typeLine?: string } | null;
  if (!c) { console.log(`  (missing: ${name})`); continue; }
  prepared.push({ name: c.name, clauses: segment(c.oracleText ?? "", c.keywords ?? [], c.typeLine ?? "") });
}

for (const run of ["run1", "run2"]) {
  const results: { name: string; clauses: Clause[]; output: unknown }[] = [];
  for (const p of prepared) {
    // keyword / reminder / level clauses state no game action. Asking the model about them
    // produced pure drift (a "Level 2" divider came back add-counter on one run and level-up on
    // the next), so they are answered here and never sent. Their slots are still filled, so the
    // completeness invariant holds.
    const INERT = new Set(["keyword", "reminder", "level"]);
    const askable = p.clauses.filter((c) => !INERT.has(c.kind));
    const synthesized = p.clauses.filter((c) => INERT.has(c.kind))
      .map((c) => ({ id: c.id, abilityType: "none", actions: [{ verb: "none", object: c.text }] }));
    const listed = askable.map((c) =>
      `${c.id}. [${c.kind}${c.marker ? ` ${c.marker}` : ""}]` +
      `${c.abilityType ? ` type=${c.abilityType}` : ""}${c.cost ? ` cost="${c.cost}"` : ""}` +
      `${c.costActions ? ` costActions=[${c.costActions.join(",")}]` : ""} ${c.text}`).join("\n");
    let parsed: unknown;
    try {
      const raw = await provider.chat([
        { role: "system", content: SYSTEM },
        { role: "user", content: `Card: ${p.name}\nClauses:\n${listed}` },
      ]);
      const got = JSON.parse(raw) as { clauses?: unknown[] };
      parsed = { clauses: [...(got.clauses ?? []), ...synthesized].sort((a, b) => (a as { id: number }).id - (b as { id: number }).id) };
    } catch (e) { parsed = { ERROR: (e as Error).message.slice(0, 200) }; }
    results.push({ name: p.name, clauses: p.clauses, output: parsed });
    process.stdout.write(".");
  }
  writeFileSync(join(OUT, `${run}.json`), JSON.stringify(results, null, 1));
  console.log(` ${run}`);
}
console.log(`\nwrote ${OUT}/run1.json and run2.json — score with: tsx src/bin/normalize-score.ts ${OUT}`);
await s.close();
