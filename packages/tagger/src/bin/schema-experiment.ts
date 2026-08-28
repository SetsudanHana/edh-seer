/** Multi-arm extraction experiment. Same 20 adversarial cards through every arm, output written
 *  for a hand audit against oracle text. Nothing touches the database.
 *
 *  The arms answer four separate questions that all bear on "rewrite the tagger vocabulary?":
 *    1. SCHEMA RICHNESS  A-clause vs B-ast     — does accuracy fall as the schema gets richer?
 *    2. BATCHING         prod-single vs prod-batch — production tags 40 cards per call, and the
 *                        13%-wrong audit was measured on that output. If batching is the cause,
 *                        the vocabulary is not the problem.
 *    3. MODEL TIER       A-clause on haiku vs sonnet — changes the cost calculus for 20k cards.
 *    4. DETERMINISM      A-clause run twice — quantifies how much of the 14% re-tag churn is
 *                        model nondeterminism rather than the prompt change.
 *
 *  Usage: tsx src/bin/schema-experiment.ts [outDir] [arms]   (needs ANTHROPIC_API_KEY)
 *    arms defaults to all; pass a comma list to run a subset, e.g. "A-single,B-single".
 *    Estimated cost for all arms on haiku plus one sonnet arm: well under $2. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect, loadConfig } from "@edh-seer/data";
import { loadTaggerConfig } from "../config.js";
import { createProvider } from "../llm/factory.js";
import { buildAbilityMessages } from "../llm/prompt.js";
import type { ChatMessage } from "../llm/provider.js";
import { docToCard } from "@edh-seer/data";

const OUT = process.argv[2] ?? "/tmp/schema-exp";
const ONLY = process.argv[3] ? new Set(process.argv[3].split(",")) : null;

const CARDS = [
  // Wrong or partial in the 50-card quality audit.
  "Balan, Wandering Knight", "Path to Exile", "Kura, the Boundless Sky", "Feeling of Dread",
  "Heritage Reclamation", "Contaminated Drink", "Nervous Gardener", "Swiftfoot Boots",
  "Cultivate", "The Elderspell", "Crystalline Giant",
  // Empty despite real rules text.
  "Bitterblossom", "Counterspell", "Supreme Verdict", "Phyrexian Tower", "Sen Triplets",
  // Structural shapes that break schemas.
  "Innkeeper's Talent", "Urza's Saga", "Riverglide Pathway // Lavaglide Pathway",
  "Yarok, the Desecrated",
];

const SCHEMA_A = `You NORMALIZE a Magic card's rules text. You do NOT classify or interpret it.
Split the text into clauses. For each clause emit one record:

{ "abilityType": "spell" | "activated" | "triggered" | "static",
  "cost": string | null,                       // activated only, verbatim
  "trigger": { "event": string, "subject": string, "zone": string | null } | null,
  "actions": [ { "verb": Verb, "object": string, "fromZone": string|null, "toZone": string|null,
                 "quantity": string|null, "optional": boolean, "condition": string|null } ] }

Verb is EXACTLY one of: destroy, exile, sacrifice, tap, untap, draw, discard, mill, search, put,
return, create, counter-spell, copy, gain-life, lose-life, deal-damage, add-mana, add-counter,
remove-counter, grant-ability, modify-pt, prevent, cast, play, shuffle, reveal, attach, transform.

Rules:
- Record what the text SAYS, in its own words, not what it means strategically. "Destroy target
  creature" is verb "destroy", never a category like "removal".
- fromZone/toZone are the zones an object moves between (battlefield, graveyard, hand, library,
  exile, stack) — set them ONLY when the clause moves something.
- trigger.event is the literal trigger wording reduced to a phrase: "enters", "dies", "attacks",
  "beginning of upkeep", "beginning of combat", "end step", "cast a spell", "turned face up".
- Evergreen keyword lines (flying, trample, ward N, protection from X) produce NO record.
- Reminder text in parentheses produces NO record.
Return ONLY { "abilities": [ ... ] }.`;

const SCHEMA_B = `You produce a formal semantic AST for a Magic card, per the Comprehensive Rules.
For each ability emit:

{ "abilityType": "spell" | "activated" | "triggered" | "static" | "mana",
  "cost": { "mana": string|null, "additional": string[] } | null,
  "trigger": { "event": string, "subject": Selector, "zone": string|null,
               "interveningIf": string|null } | null,
  "effects": [ Effect ],
  "continuous": { "layer": 1|2|3|4|5|6|7, "sublayer": string|null, "duration": string,
                  "dependency": string|null } | null,
  "replacement": { "replacedEvent": string, "replacementKind": "modify"|"substitute"|"prevent",
                   "selfReplacing": boolean } | null }

Selector = { "quantifier": "target"|"each"|"all"|"up-to"|"any-number"|"self",
             "count": number|"X"|null, "types": string[], "subtypes": string[],
             "controller": "you"|"opponent"|"any", "predicates": string[] }

Effect = { "action": string, "selector": Selector|null, "fromZone": string|null,
           "toZone": string|null, "amount": string|null, "optional": boolean,
           "copiableValues": string[]|null, "timing": string|null }

Rules:
- Continuous effects MUST carry their CR 613 layer (1 copy, 2 control, 3 text, 4 type, 5 color,
  6 ability, 7 power/toughness) and duration.
- Replacement effects (CR 614) MUST be modelled as replacement, never as a trigger.
- Targeting (CR 115) is expressed by selector.quantifier: "target" only when the text says target.
- Characteristic-defining abilities are continuous with layer 7 and duration "always".
Return ONLY { "abilities": [ ... ] }.`;

const HAIKU = "claude-haiku-4-5";
const SONNET = "claude-sonnet-5";

interface Arm { name: string; schema: string | "PROD"; model: string; batch: number }
const ARMS: Arm[] = [
  { name: "A-single", schema: SCHEMA_A, model: HAIKU, batch: 1 },
  { name: "A-single-rerun", schema: SCHEMA_A, model: HAIKU, batch: 1 },   // determinism
  { name: "A-batch10", schema: SCHEMA_A, model: HAIKU, batch: 10 },        // batching effect
  { name: "A-single-sonnet", schema: SCHEMA_A, model: SONNET, batch: 1 },  // model tier
  { name: "B-single", schema: SCHEMA_B, model: HAIKU, batch: 1 },          // schema richness
  { name: "B-single-sonnet", schema: SCHEMA_B, model: SONNET, batch: 1 },  // richness x tier
  { name: "prod-single", schema: "PROD", model: HAIKU, batch: 1 },         // current prompt, unbatched
];

const s = await connect(loadConfig());
const cfg = loadTaggerConfig();
mkdirSync(OUT, { recursive: true });

const docs: { name: string; oracleText: string; typeLine: string; doc: unknown }[] = [];
for (const name of CARDS) {
  const c = (await s.db.collection("cards").findOne({ name })) as
    { name: string; oracleText?: string; typeLine?: string } | null;
  if (!c) { console.log(`  (missing card: ${name})`); continue; }
  docs.push({ name: c.name, oracleText: c.oracleText ?? "", typeLine: c.typeLine ?? "", doc: c });
}

for (const arm of ARMS) {
  if (ONLY && !ONLY.has(arm.name)) continue;
  const provider = createProvider({ ...cfg, model: arm.model, maxTokens: arm.batch > 1 ? 8000 : 2000 });
  const results: { name: string; oracleText: string; output: unknown }[] = [];

  for (let i = 0; i < docs.length; i += arm.batch) {
    const slice = docs.slice(i, i + arm.batch);
    let messages: ChatMessage[];
    if (arm.schema === "PROD") {
      messages = buildAbilityMessages(docToCard(slice[0].doc as never));
    } else if (arm.batch === 1) {
      messages = [
        { role: "system", content: arm.schema },
        { role: "user", content: `Card: ${slice[0].name}\nType: ${slice[0].typeLine}\nText:\n${slice[0].oracleText}` },
      ];
    } else {
      messages = [
        { role: "system", content: arm.schema },
        { role: "user", content:
          `Return { "results": [ { "name": string, "abilities": [...] } ] } — one entry per card.\n\n` +
          slice.map((d) => `Card: ${d.name}\nType: ${d.typeLine}\nText:\n${d.oracleText}`).join("\n\n") },
      ];
    }
    let raw = "";
    try { raw = await provider.chat(messages); } catch (e) { raw = `ERROR: ${(e as Error).message}`; }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { parsed = { PARSE_FAILED: raw.slice(0, 400) }; }

    if (arm.batch === 1) results.push({ name: slice[0].name, oracleText: slice[0].oracleText, output: parsed });
    else {
      const byName = new Map(((parsed as { results?: { name: string }[] }).results ?? []).map((r) => [r.name, r]));
      for (const d of slice) results.push({ name: d.name, oracleText: d.oracleText, output: byName.get(d.name) ?? { MISSING_FROM_BATCH: true } });
    }
    process.stdout.write(".");
  }
  writeFileSync(join(OUT, `${arm.name}.json`), JSON.stringify(results, null, 1));
  console.log(` ${arm.name} (${arm.model}, batch ${arm.batch}) -> ${results.length} cards`);
}
console.log(`\nwrote arms to ${OUT}`);
await s.close();
