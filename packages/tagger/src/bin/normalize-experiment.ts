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
  "cant", "none"];
const ZONES = ["battlefield", "graveyard", "hand", "library", "exile", "stack", "command"];
const TRIGGERS = ["enters", "dies", "leaves", "attacks", "blocks", "taps", "untaps", "cast",
  "upkeep", "begin-combat", "end-step", "draw-step", "damage-dealt", "life-gained", "life-lost",
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
- A clause of kind "keyword" or "reminder" gets abilityType "none" and actions [{verb:"none"}].
- OMIT the trigger field entirely when the clause is not triggered. Do not send trigger:null and
  do not send event:"none" — one fact must have exactly one encoding, or two runs disagree over
  nothing. (This ambiguity alone accounted for every residual disagreement in the first run.)
- "trigger-again" is for effects that make a triggered ability trigger an additional time.
- A cost shown as cost="..." is ALSO recorded in actions when it does something a payoff could
  care about: cost="{T}, Sacrifice a creature" yields a sacrifice action as well as the effect.
  A sacrifice hidden in a cost string is invisible to every payoff that triggers on sacrificing.
- List one action per game action the clause states, in the order written.
- "cant" is for restrictions ("can't attack", "can't be countered"); put the restriction in object.
Return ONLY { "clauses": [ ... ] }.`;

const s = await connect(loadConfig());
const cfg = loadTaggerConfig();
const provider = createProvider({ ...cfg, maxTokens: 3000 });
mkdirSync(OUT, { recursive: true });

const prepared: { name: string; clauses: Clause[] }[] = [];
for (const name of CARDS) {
  const c = (await s.db.collection("cards").findOne({ name })) as
    { name: string; oracleText?: string; keywords?: string[]; typeLine?: string } | null;
  if (!c) { console.log(`  (missing: ${name})`); continue; }
  prepared.push({ name: c.name, clauses: segment(c.oracleText ?? "", c.keywords ?? [], c.typeLine ?? "") });
}

for (const run of ["run1", "run2"]) {
  const results: { name: string; clauses: Clause[]; output: unknown }[] = [];
  for (const p of prepared) {
    const listed = p.clauses.map((c) =>
      `${c.id}. [${c.kind}${c.marker ? ` ${c.marker}` : ""}]` +
      `${c.abilityType ? ` type=${c.abilityType}` : ""}${c.cost ? ` cost="${c.cost}"` : ""} ${c.text}`).join("\n");
    let parsed: unknown;
    try {
      const raw = await provider.chat([
        { role: "system", content: SYSTEM },
        { role: "user", content: `Card: ${p.name}\nClauses:\n${listed}` },
      ]);
      parsed = JSON.parse(raw);
    } catch (e) { parsed = { ERROR: (e as Error).message.slice(0, 200) }; }
    results.push({ name: p.name, clauses: p.clauses, output: parsed });
    process.stdout.write(".");
  }
  writeFileSync(join(OUT, `${run}.json`), JSON.stringify(results, null, 1));
  console.log(` ${run}`);
}
console.log(`\nwrote ${OUT}/run1.json and run2.json — score with: tsx src/bin/normalize-score.ts ${OUT}`);
await s.close();
