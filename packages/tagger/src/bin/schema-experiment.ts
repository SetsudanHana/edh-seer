/** Measures whether extraction accuracy falls as schema richness rises.
 *
 *  Runs the SAME cards through two competing normalizations — a clause-level rules-primitive
 *  schema and a richer CR-flavoured AST — and writes both outputs for a hand audit against oracle
 *  text. The card list is deliberately adversarial: every card the 50-card quality audit found
 *  broken, plus the structural shapes that break schemas (Class, Saga, MDFC, replacement effect).
 *
 *  Usage: tsx src/bin/schema-experiment.ts [outDir]      (needs ANTHROPIC_API_KEY) */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect, loadConfig } from "@mtg/data";
import { loadTaggerConfig } from "../config.js";
import { createProvider } from "../llm/factory.js";

const OUT = process.argv[2] ?? "/tmp/schema-exp";

const CARDS = [
  // Cards the quality audit found wrong or partial.
  "Balan, Wandering Knight", "Path to Exile", "Kura, the Boundless Sky", "Feeling of Dread",
  "Heritage Reclamation", "Contaminated Drink", "Nervous Gardener", "Swiftfoot Boots",
  "Cultivate", "The Elderspell", "Crystalline Giant",
  // Cards that were empty despite real text.
  "Bitterblossom", "Counterspell", "Supreme Verdict", "Phyrexian Tower", "Sen Triplets",
  // Structural shapes that break schemas.
  "Innkeeper's Talent",          // Class, leveled
  "Urza's Saga",                 // Saga, chapter abilities, land
  "Riverglide Pathway // Lavaglide Pathway", // MDFC
  "Yarok, the Desecrated",       // replacement effect on triggers
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

const s = await connect(loadConfig());
const cfg = loadTaggerConfig();
const provider = createProvider({ ...cfg, maxTokens: 8000 });
mkdirSync(OUT, { recursive: true });

for (const [label, schema] of [["A-clause", SCHEMA_A], ["B-ast", SCHEMA_B]] as const) {
  const results: { name: string; oracleText: string; output: unknown }[] = [];
  for (const name of CARDS) {
    const c = (await s.db.collection("cards").findOne({ name })) as { name: string; oracleText?: string; typeLine?: string } | null;
    if (!c) { console.log(`  (missing card: ${name})`); continue; }
    const raw = await provider.chat([
      { role: "system", content: schema },
      { role: "user", content: `Card: ${c.name}\nType: ${c.typeLine ?? ""}\nText:\n${c.oracleText ?? ""}` },
    ]);
    let output: unknown;
    try { output = JSON.parse(raw); } catch { output = { PARSE_FAILED: raw.slice(0, 400) }; }
    results.push({ name: c.name, oracleText: c.oracleText ?? "", output });
    console.log(`${label}: ${c.name}`);
  }
  writeFileSync(join(OUT, `${label}.json`), JSON.stringify(results, null, 1));
}
console.log(`\nwrote ${OUT}/A-clause.json and ${OUT}/B-ast.json`);
await s.close();
