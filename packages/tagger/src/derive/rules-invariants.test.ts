/** WHAT THE DERIVE LAYER KNOWS ABOUT THE RULES, EXECUTABLE (roadmap AC10, 2026-09-09).
 *
 *  320 comment sites cite a CR rule and almost none was an assertion. This file is the honest list:
 *  every rule number cited anywhere in the tagger's source is either ASSERTED here on a minimal
 *  fixture, TESTED elsewhere (named), or PROSE — a reading in a comment with no fixture yet. The
 *  ledger is ratcheted against the source: a citation the ledger does not know fails, and a ledger
 *  row nothing cites any more fails, so the list cannot drift in either direction. The matcher has
 *  a twin (`packages/matcher/src/rules-invariants.test.ts`). */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { deriveAbilities } from "./derive.js";
import { actionEmits } from "./emits.js";
import { actionEffectKind } from "./effect-kind.js";
import { emblemRecipient } from "../emblem.js";

const ASSERTED = new Set(["104.3", "106.12a", "111.1", "111.2", "114.1", "114.2", "601.2f", "603.8", "603.12", "614", "701.5", "701.17a", "701.22b"]);
const TESTED: Record<string, string> = {
  "609.4b": "grammar/clause-record.test.ts — a spend-mana-as-any-colour rider changes how a cost is paid, not the cost: it stays an unclaimed `other` after the cast or play, never stripped (Evelyn, Tinybones, #1355)",
  "701.62": "manifest dread: its mill is of your library (emits.test.ts, manifest dread mills the top-two card of YOUR library)",
  "104.2b": "derive.test.ts — a win-game VERB derives the win-game kind (Epic Struggle, Laboratory Maniac, #1266)",
  "603.1": "matcher partners-core.test.ts — a claimsNothing ability is still a triggered ability: a copier is offered the copies|triggered key (#1253)",
  "306.5b": "derive/mana-lines.test.ts — a planeswalker's printed loyalty rides on each of its loyalty-cost mana lines (ManaLine.startLoyalty, #1169)",
  "606.6": "derive/mana-lines.test.ts — a loyalty cost needs that many counters, so the line carries the starting loyalty a consumer compares it with (#1169)",
  "113.6": "derive.test.ts — a card whose own static says it isn't a creature under a condition is marked creatureOnlyIf (#797)",
  "608.2c": "derive.test.ts — an unnamed draw is yours; a named one is the player it names (#697)",
  "508.1a": "derive/intervening-if.test.ts — only a creature attacks, so \"if you attacked this turn\" cares about attacks:creature (#1088)",
  "701.47a": "grammar/action.test.ts + derive/emits.test.ts — amass reads as your 0/0 black Army token of its subtype, and emits it with a +1/+1 counter (#971)",
  "701.16a": "derive/emits.test.ts — investigate's token is an artifact Clue (#794)",
  "903.5b": "derive.test.ts — Guardian Project's 'doesn't have the same name' is uniqueName: a singleton printed card, never a token or an any-number card (#896 task 5)",
  "504.1": "derive.test.ts — Bowmasters' 'except the first one they draw in each of their draw steps' leaves out only the turn-based draw: still claimed (#896 task 5)",
  "400.3": "grammar/trigger.test.ts — a card goes to its owner's graveyard: \"put into an opponent's graveyard\" is an opponent's card (#896 task 5)",
  "509.1a": "grammar/trigger.test.ts — only a creature blocks, so 'becomes blocked by a creature' narrows nothing (#896 task 5)",
  "509.1h": "schema.test.ts — only an attacking creature becomes blocked, so a becomes-blocked trigger naming no class implies creature (VERB_IMPLIED_CLASS, #1375)",
  "509.3c": "derive/repeats.test.ts — 'whenever [a creature] becomes blocked' triggers once each combat for that creature: a self / equipped creature is once a combat (#1375)",
  "509.3d": "derive/repeats.test.ts — 'becomes blocked by a creature' triggers once for EACH blocker: no once-a-combat bound (#1375)",
  "509.3e": "derive/repeats.ts CEILING — a threshold ('by two or more creatures') triggers once, which BLOCKED_BY reads as once per blocker; latent until #1381 lifts the narrowing refusal",
  "702.6a": "grammar/trigger.test.ts — equip attaches to a creature you control, so an Equipment's host is yours (#896 task 5)",
  "110.2": "scaling.test.ts — a permanent's owner and controller differ: Zedruu counts permanents you own that your opponents control",
  "105.2a": "grammar/filter.test.ts — 'monocolored' is exactly one colour (`colorCount: mono`, #896)",
  "105.2b": "grammar/filter.test.ts — 'multicolored' is two or more colours (`colorCount: multi`, #896)",
  "110.5": "grammar/filter.test.ts — tapped/untapped is a status (`tapped`, #896)",
  "723.1": "derive/gains-control-printed.test.ts — controlling a player (Opposition Agent) is a printed control change and keeps its gains-control emit (#1318)",
  "723.3": "derive/either-or-players.test.ts — only control of the player changes, so Cruel Entertainment's two player-controls-player actions are unclaimed, not two 'you gain control' emits (#1401 G)",
  "502.3": "derive.test.ts — \"doesn't untap during its controller's untap step\" is `untap-denial` with its duration: continuous (Hold for Questioning, Choke), the next untap step (Frost Trickster), for as long as (Icefall Regent) (#1423)",
  "702.11": "derive.test.ts — hexproof's scoped printed form is `targeting-ban` by spells or abilities your opponents control (Shielding Plax, Canopy Cover, #1423)",
  "702.18": "derive.test.ts — shroud's scoped printed form is `targeting-ban` with no source restriction (Ground Seal's cards in graveyards, #1423)",
  "115.7": "derive.test.ts — an effect that changes the target(s) of / chooses new targets for a TARGET spell or ability is `retarget`; your own copy's new targets are not (#1266, #491)",
  "115.1": "grammar/filter.test.ts — what a spell targets is `targets` (#896)",
  "205.4c": "grammar/filter.test.ts — nonbasic is `basic: false` (#896)",
  "205.4g": "grammar/filter.test.ts — snow is a supertype (`snow`, #896)",
  "121.5": "derive/to-hand.test.ts — a put from the top of your library into your hand without a search is `to-hand`, never a draw or a search (#1302)",
  "509.1b": "derive.test.ts — a blocking restriction an attacker carries (`cant | be blocked ...`: except by Walls, by power 3 or greater, this turn) is `evasion`; \"must be blocked\" is not, and \"can't block\" is a `restriction` (#1315)",
  "508.1c": "derive.test.ts / effect-kind.test.ts — \"can't attack\" / \"can't block\" / \"can't attack or block\" is a `restriction` carrying which actions (`restricts`); \"can't attack you\" (a tax), a requirement and a narrowed block are not (#1315)",
  "301.5": "derive.test.ts — an Equipment's 'equipped creature' recipient is the host: `Ability.host` (Bonesplitter, Hexgold Halberd, #1315)",
  "303.4": "derive.test.ts — an Aura's 'enchanted creature / permanent' recipient is the host: `Ability.host` (Rancor, Fists of the Demigod, Clutch of Undeath, #1315)",
  "111.4": "grammar/filter.test.ts — a token's own name is not a card to look for ('Marit Lage, a legendary ... token', 'token ... named Storm Crow') (#896)",
  "601": "schema.test.ts — a spell is cast, so a cast trigger naming no class implies spell (VERB_IMPLIED_CLASS, #1166)",
  "603.6a": "schema.test.ts — only a permanent enters, so an enters trigger naming no class implies permanent (VERB_IMPLIED_CLASS, #1166)",
  "510.1a": "grammar/action.test.ts — 'assigns combat damage equal to its toughness rather than its power' keeps the stored reading (#896 fragments 11)",
  "122.1a": "grammar/action.test.ts — any '+X/+Y' counter is a kind ('put a +1/+2 counter on target creature', #896 fragments 15)",
  "509.1c": "grammar/action.test.ts — a block requirement ('must be blocked if able', 'blocks this creature this turn if able') is the store's cant (#896 fragments 4)",
  "604.3": "grammar/action.test.ts — a characteristic-defining ability ('Titania's power and toughness are each equal to ...') is the card's own modify-pt (#896 fragments 7)",
  "707.9b": "grammar/filter.test.ts — a copy's exceptions ('except it isn't legendary', 'except it has haste') are kept (#896)",
  "108.4": "derive.test.ts — a card off the battlefield has no controller: its owner is the `control` derive reads (Ulamog's Nullifier, #896 task 3)",
  "108.3": "grammar/filter.test.ts — ownership beside control: 'you control but don't own' (#896)",
  "715": "grammar/filter.test.ts — an Adventure is a card's layout, read as a status (#896)",
  "702.22b": "grammar/filter.test.ts — 'bands with other' is a keyword a token can have (Master of the Hunt) (#896)",
  "702.26a": "grammar/action.test.ts — 'Simultaneously, all phased-out creatures phase in and all creatures with phasing phase out' (Time and Tide): a timing word, then two phasing actions (#1210)",
  "702.26c": "grammar/action.test.ts — 'target creature phases in' is the `phase-in` action, the twin of `phase-out` (#1210)",
  "106.12b": "derive/mana-lines.test.ts — a replacement on a basic land tapped for mana ('produces mana of a color of your choice', Pulse of Llanowar) is a basics static fixer and no mana line (#1210)",
  "702.95": "grammar/filter.test.ts — a soulbond pair is a status the filter can demand ('a creature paired with it') (#896)",
  "810": "grammar/filter.test.ts — a Two-Headed Giant team's permanents ('creatures your team controls') are yours (#896)",
  "701.34a": "grammar/clause-record.test.ts — a proliferate's object is any permanent or player, not only yours (task 7, #896)",
  "701.41a": "grammar/clause-record.test.ts — support's object is other target creatures (task 7, #896)",
  "706.2": "grammar/clause-record.test.ts — a die-roll modifier (Xenosquirrels) is a static clause keyed on the roll, not a triggered ability (#1210)",
  "702.170c": "grammar/clause-record.test.ts — 'it becomes plotted' reads as no action, never an animation (Make Your Own Luck, #1210)",
  "701.15": "grammar/filter.test.ts — goaded is a status the filter can demand (#896)",
  "701.60": "grammar/filter.test.ts — suspected is a status the filter can demand (#896)",
  "702.33": "grammar/filter.test.ts — a kicked spell is a status the filter can demand (#896)",
  "303.4a": "grammar/filter.test.ts — an Aura's enchant line names the class it can enchant ('Enchant creature you control') (#896 task 2)",
  "112.2": "grammar/filter.test.ts — a spell's controller is the player who cast it: 'spells you cast' reads control you (#896 task 2)",
  "110.2a": "derive.test.ts — what you put onto the battlefield enters under your control (Misty Rainforest)",
  "118.12a": "derive.test.ts / clause-store.test.ts — an action's unless-payment rides onto the ability, and a doc that dropped one is re-asked",
  "602.1a": "payment.test.ts — an activation cost is read part by part into payment, an unread part kept verbatim",
  "602.2b": "derive/mana-lines.test.ts — an activated ability that targets (Deathrite Shaman, Red Death, Shipwrecker) holds only while a legal target exists, so its mana line is gated on it (#1188)",
  "605.1a": "derive.test.ts — a mana ability's amount is the mana its object adds (Sol Ring 2, Talisman 1, Gilded Lotus 3)",
  "701.21a": "payment.test.ts — a sacrifice in a cost is of your own permanents, so its class is control you",
  "702.14": "derive.test.ts — a landwalk grant names its [type]walk (Lord of Atlantis islandwalk, Vectis Gloves landwalk)",
  "702.4": "effect-kind.test.ts — Double Strike is a keyword, not the verb double (Akim, the Soaring Wind) (#1141)",
  "702.153a": "emits.test.ts / derive.test.ts — casualty N sacrifices a creature with power N or greater (Anhelo's grant, Make Disappear's keyword line)",
  "702.177a": "repeats.test.ts — an Exhaust ability repeats once (Loot, the Pathfinder)",
  "700.11": "intervening-if.test.ts — 'you descended this turn' cares about permanents hitting your graveyard",
  "701.14a": "derive.test.ts — a fight's dealer is the fighting creature, not the spell",
  "603.2e": "derive.test.ts — a token created tapped is not 'tapped' by an effect: no taps event for a permanent that arrives that way",
  "603.2c": "derive.test.ts — 'whenever one or more ... enter' is batched: one firing per event, however many objects (edge magnitude)",
  "712.14": "derive.test.ts — a self re-entry with no 'transformed' is left unmarked: front face up",
  "712.14a": "derive.test.ts — 'return it to the battlefield transformed' marks the re-entry as the back face (#715)",
  "701.27a": "derive.test.ts — transforming turns over a permanent already there; 'enters transformed' is not an enters trigger (Corruption of Towashi)",
  "702.162": "characteristics.test.ts — a More Than Meets the Eye card is cast from either face",
  "113.8": "derive.test.ts — \"you\" in a granted ability is the recipient's controller (Hellish Rebuke)",
  "122.1b": "subject.test.ts — every keyword counter named by rule 122.1b is in the dictionary",
  "122.1h": "derive.test.ts — a return with a finality counter is once per object (#886)",
  "614.1c": "derive.test.ts — entering WITH counters is 614.1c, not placing counters later",
  "614.6": "derive.test.ts — a replaced graveyard put never happens: Rest in Peace and Leyline emit exiled and no graveyard leave",
  "701": "cr-completeness.test.ts — every CR 701 keyword action is covered by a verb or excluded",
  "702": "cr-completeness.test.ts — every CR 702 keyword ability is known",
  "703": "cr-completeness.test.ts — the CR 703/116 residue words",
  "603.2": "trigger-completeness.test.ts — every rule-defined event has a word or a verdict",
  "701.3d": "trigger-completeness.test.ts (unattached) and verb-accounting.test.ts (unattach OPEN)",
  "114": "cr-sections.test.ts — 114 stays MODELLED",
  "707": "emits.test.ts / derive.test.ts — copy is the kind `clone`, no emit (verb-accounting OPEN)",
  "705": "verb-accounting.test.ts — flip-coin is OPEN",
  "706.1": "emits — roll-dice emits dice-rolled (706.1 defines the roll)",
  "705.1": "emits — a coin is flipped by the ability's controller; flip-coin joins CONTROLLER_DEFAULT (AC11 batch 4)",
  "706": "verb-accounting.test.ts / emits — roll-dice emits dice-rolled",
  "603.2h": "grammar/restriction.test.ts — 'Do this only once each turn' is a restriction sentence the action grammar absorbs; derive reads it off the printed clause (#1349)",
  "602.5": "threshold.test.ts — 'activate only if' gates the whole ability, the one later sentence that is not a rider",
  "611.3a": "threshold.test.ts / derive.test.ts — a static's 'as long as' count is a threshold on the ability",
  "702.5a": "characteristics.test.ts — an Aura's Enchant line is carried as `characteristics.enchants`",
  "301.5b": "damaged-player-graveyard.test.ts (matcher) — equip attaches to a creature you control, so the player it damages is an opponent (#1250)",
  "511.2": "matcher leaves-without-dying.test.ts — an 'at end of combat' destroy triggers as the step begins, so it still kills an attacker (Goblin Sappers -> Kardur)",
  "511.3": "matcher leaves-without-dying.test.ts — creatures leave combat only as the end of combat step ends",
  "301.5c": "repeats.test.ts — an Equipment outlives its host, so equipped-dies repeats once a round (Skullclamp)",
  "704.5m": "matcher edges.test.ts — a producer removing what an Aura enchants supplies the Aura's own dies trigger",
  "120.1": "derive.test.ts — the receiving side of damage is its own verb `damaged`, never the dealing one",
  "603.7a": "delayed-trigger.test.ts — a delayed trigger's rate is its creator's: a chapter, a spell, an activation",
  "603.7b": "delayed-trigger.test.ts — \"when you next\" fires once per creation, so a chapter's or a spell's is once",
  "119.5": "derive.test.ts — a life total set is neither damage nor life loss: The Golden Throne, Arbiter of Knollridge (#1266)",
  "714.3": "grammar/clause-record.test.ts — a Saga's reminder line (lore counters, sacrifice after the last chapter) is the store's inert record: Year of Hell, The Eldest Reborn (#1349)",
  "721.2": "grammar/clause-record.test.ts — every line under a Station bar, to the next bar or the card's end, is gated at that bar's N; lines before the first bar are not: Entropic Battlecruiser, Seriema (#1349)",
  "721.2a": "grammar/clause-record.test.ts — a Station row's 'N+ |' bar is read past and its row GATED at N charge counters (threshold {atLeast: N}): D-7 Battle Cruiser, Wedgelight Rammer (#1349)",
  "700.2": "grammar/clause-record.test.ts — a spell or ability with a bulleted list of options preceded by an instruction to choose a number of them is modal and supplies `face-a-dilemma` once, from its header: Kolaghan's Command, Charming Prince, Aetheric Amplifier (#1349)",
  "700.2a": "grammar/clause-record.test.ts — a modal spell or activated ability has its modes chosen as it is cast or activated: the header's emit is on-cast / activated with its cost (#1349)",
  "700.2e": "grammar/clause-record.test.ts — another player choosing the modes (Library of Lat-Nam, 'an opponent chooses one') is not YOUR dilemma and emits none (#1349)",
  "702.172a": "grammar/clause-record.test.ts — Spree means 'Choose one or more modes': the keyword line is a modal header and emits `face-a-dilemma`: Final Showdown (#1349)",
  "702.183a": "grammar/clause-record.test.ts — Tiered means 'Choose one': the keyword line is a modal header and emits `face-a-dilemma`: Thunder Magic (#1349)",
  "402.2": "grammar/clause-record.test.ts — 'you have no maximum hand size [until your next turn]' states a player's maximum hand size (CR 402 Hand); read as the store's unclaimed `other`: Graceful Adept, Deep Space Scan (#1349)",
  "731.1": "grammar/clause-record.test.ts — 'it becomes day' / 'it becomes night' is the game gaining the day or night designation, never an animate of the card: Sunstreak Phoenix (#1349)",
  "702.148": "derive.test.ts — the words in a cleave spell's square brackets are removed: Alchemist's Retrieval bounces ANY nonland permanent (#1295)",
};
/** A reading in a comment, no fixture. Each carries where the reading lives. */
const PROSE: Record<string, string> = {
  "301.5d": "CEILING note on damagedPlayerIsOpponent: an Equipment's controller is separate from the equipped creature's; not modelled",
  "100.2a": "schema: the CR's own numbering for a rules reference", "104.2": "verb-accounting: win-game NOT AN EVENT",
  "106.4": "normalize-prompt / verb-accounting: mana-spent, add-mana",
  "107.14": "normalize-prompt ENERGY rule: {E} is a counter", "120": "derive: damage direction split by text",
  "122": "counters — COUNTER_KINDS", "205.3": "subtypes generated from MTGJSON", "205.3g": "artifact types, unioned from the rules (gen-vocabulary withCr)", "205.3m": "creature types: the list MTGJSON's extra \"Missing\" is absent from (gen-vocabulary NOT_FREE_TEXT, tested in gen-vocabulary-core.test.ts)", "111.10": "predefined tokens pin their type (token-types.ts)", "111.10a": "a Treasure token is an artifact", "700.5": "devotion to a colour counts the pips of its own mana cost, a hybrid pip for each colour (mana-lines.test.ts, #1285)", "111.10w": "a Vibranium token taps for {C}, spendable only on artifacts (token-kinds.ts line, mana-lines.test.ts)", "111.10x": "a Heartwood token taps for {R} or {G} (token-kinds.ts line, mana-lines.test.ts)", "205.3i": "subtypes: Saga", "205.3k": "subtypes: Class",
  "305": "lands", "305.1": "play a land is `play`, not `enters`", "307.5": "a sorcery's own text", "309": "dungeons: words, no room model",
  "400.1": "ZONES lists the seven", "400.7": "zone changes: the enters/leaves family", "406.2": "exile is a public zone",
  "500": "phase words", "500.7": "extra turn: NOT AN EVENT", "506.4": "removed from combat", "602": "activate, a word with no producer",
  "603.4": "intervening-if (ratcheted in intervening-if-ratchet.test.ts)", "603.6c": "leaves-the-battlefield reads its zone off the text",
  "603.7": "schema: `delayedBy` names what created a delayed trigger",
  "606": "loyalty abilities", "606.3": "loyalty cost is a counter change", "608": "resolves, a word", "609.7": "damage from a source",
  "611": "continuous effects: NOT AN EVENT verbs", "613": "layers: OPEN", "613.1f": "P/T layer", "614.17": "cant: NOT AN EVENT",
  "615": "prevent: OPEN", "615.13": "prevented, a word", "700.11": "descended", "700.12": "outlaw", "700.13": "crime", "700.14": "expend",
  "700.16": "worthy", "700.4": "dies (matcher asserts it)", "700.8": "party", "700.9": "modified",
  "701.10": "double: OPEN", "701.11": "triple: OPEN", "701.12": "exchange: OPEN", "701.14": "fight emits non-combat-damage", "701.17": "mill",
  "701.19": "regenerate is a shield, emits nothing", "701.20": "reveal: OPEN", "701.24": "shuffle: OPEN", "701.22": "scry", "701.22a": "scry never touches a graveyard",
  "701.23": "search", "701.23a": "search means a search HAPPENED", "701.25": "surveil", "701.25a": "surveil's graveyard half is any number",
  "701.3": "attach: OPEN", "701.30": "clash", "701.40a": "manifest is a card, not a token", "701.16": "investigate names no object; the rule supplies the Clue", "701.45a": "assemble excluded (Unstable)",
  "701.50": "connive", "701.54": "the Ring tempts", "701.7": "create", "701.68": "blight", "701.47": "amass: counter-placement, emits the Army token and its +1/+1 counter", "701.71": "empower Jace: amass's shape, counter-placement, emits nothing",
  "722.3": "prepared: a designation, OPEN", "722.3a": "becomes prepared, a word", "722.3b": "becomes unprepared, a word", "722.3d": "a prepare spell's cast is a prepared spell (SubjectFilter.prepared)",
  "701.46": "adapt puts its counters on the card itself (a self counter emit)", "701.37": "monstrosity puts its counters on the card itself",
  "702.100": "evolve, a trigger word", "702.110": "exploit, a word", "702.122": "becomes-crewed", "702.131": "city-blessing",
  "702.143": "foretell", "702.147": "decayed: a temporary token", "702.179": "speed", "702.189b": "firebend",
  "702.26": "phasing", "708": "face-down: OPEN", "712": "double-faced", "714.2b": "Saga chapters", "709.5i": "unlock: fully unlocking a Room, a word",
  "719": "Cases: solved, a word", "725": "monarch", "726": "initiative", "731": "day/night",
  "903": "Commander", "903.3": "the commander designation is a deck fact (matcher asserts it)",
  "118.3b": "paying life is losing life — prompt rule",
  "118.7a": "a generic reduction takes off generic mana only — reduction.ts records the printed mana; the reader applies it",
  "113.3": "schema: the ability kinds a card can name as an OBJECT (abilityKind, AC12)",
  "707.10": "schema / effect-kind: an ability is the third copyable object, kind copy-ability (AC12; derive.test asserts Gogo)",
  "707.2": "effect-kind: a clone's 'except it has this ability' is an exception to the copy, not the object copied (effect-kind.test asserts Cryptoplasm)",
  "605.3b": "schema: a mana ability does not use the stack, so 'activated' as an object excludes it (AC12)", "603.8": "state triggers — prompt rule", "603.12": "reflexive — prompt rule",
  "605.1b": "derive.ts stampManaRider CEILING: a triggered mana ability must trigger from mana, which Carnival of Souls' does not; no triggered rider is stamped (#1426)",
};

const SRC = fileURLToPath(new URL("..", import.meta.url));
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : [];
});
const cited = new Set(walk(SRC).flatMap((p) => [...readFileSync(p, "utf8").matchAll(/\bCR (\d{3}(?:\.\d+[a-z]?)?)/g)].map((m) => m[1]!)));

test("every CR rule the tagger cites is asserted, tested elsewhere, or marked prose — and nothing is listed that nothing cites", () => {
  const known = new Set([...ASSERTED, ...Object.keys(TESTED), ...Object.keys(PROSE)]);
  expect([...cited].filter((r) => !known.has(r)).sort(), "cited in source, missing from the ledger").toEqual([]);
  expect([...known].filter((r) => !cited.has(r)).sort(), "in the ledger, cited nowhere").toEqual([]);
  expect(cited.size).toBeGreaterThan(90);
});

const clause = (text: string, verb: string, object: string, trigger?: { event: string; subject: string; control?: string }) => ({
  clauses: [{ id: 1, abilityType: (trigger ? "triggered" : "static") as "triggered" | "static", ...(trigger ? { trigger } : {}), actions: [{ verb, object }] }],
  texts: { 1: text },
});

test("CR 111.1 vs 114.1: an emblem is not a token — the grant derives the kind `emblem` and no token event", () => {
  const c = clause("You get an emblem with \"Creatures you control get +1/+1.\"", "emblem", "an emblem with \"Creatures you control get +1/+1.\"");
  const { abilities } = deriveAbilities(c.clauses, "Elspeth", c.texts, undefined, c.texts[1]);
  expect(abilities[0]?.effect.kind).toBe("emblem");
  expect((abilities[0]?.emits ?? []).some((e) => e.verb === "create-token" || e.verb === "enters")).toBe(false);
});

test("CR 114.2: the recipient controls the emblem — you by default, an opponent only when the sentence says so", () => {
  expect(emblemRecipient("You get an emblem with \"...\"")).toBe("you");
  expect(emblemRecipient("Target opponent gets an emblem with \"...\"")).toBe("opp");
});

test("CR 111.2: a created token is its creator's — the emit's control is `you`", () => {
  // The default reads the SENTENCE (a player named earlier blocks it), so the clause text is required.
  const e = actionEmits({ verb: "create", object: "a 1/1 white Soldier creature token" }, "Create a 1/1 white Soldier creature token.");
  expect(e.map((x) => x.verb)).toContain("create-token");
  for (const x of e) expect(x.subject.control).toBe("you");
});

test("CR 701.17a: you may sacrifice only what you control — an unqualified sacrifice is the controller's", () => {
  for (const e of actionEmits({ verb: "sacrifice", object: "a creature" }, "Sacrifice a creature.")) expect(e.subject.control).toBe("you");
  // ...and a sentence that names another player keeps its wildcard, which is what Dark Deal needs.
  expect(actionEmits({ verb: "sacrifice", object: "a creature" }, "Each player sacrifices a creature.").every((e) => e.subject.control === "any")).toBe(true);
});

test("CR 701.22b: scry 0 is no scry event", () => {
  expect(actionEmits({ verb: "scry", object: "0", amount: "0" }, "")).toEqual([]);
  expect(actionEmits({ verb: "scry", object: "2", amount: "2" }, "").map((e) => e.verb)).toEqual(["scry"]);
});

test("CR 701.5: countering a spell is an event — the action emits it and `countered` watches it", () => {
  expect(actionEmits({ verb: "counter-spell", object: "target spell" }, "").map((e) => e.verb)).toEqual(["counter-spell"]);
});

test("CR 601.2f: a sentence about this spell's OWN cost is never a tax", () => {
  const text = "This spell costs {1}{W} more to cast for each target beyond the first.";
  expect(actionEffectKind({ verb: "cost-modify", object: "this spell" }, text)).not.toBe("tax");
  expect(actionEffectKind({ verb: "cost-modify", object: "creature spells your opponents cast" }, "Creature spells your opponents cast cost {1} more to cast.")).toBe("tax");
});

test("CR 614: a multiplier performs no action — Hardened Scales places no counter", () => {
  const text = "If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.";
  const c = clause(text, "add-counter", "+1/+1 counters");
  const { abilities } = deriveAbilities(c.clauses, "Hardened Scales", c.texts, undefined, text);
  expect(abilities.length).toBeGreaterThan(0);
  for (const a of abilities) expect(a.emits ?? []).toEqual([]);
});

test("CR 614: the multiplier's ability records what it does to the event (DERIVE 388)", () => {
  const text = "If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.";
  const c = clause(text, "add-counter", "+1/+1 counters");
  const { abilities } = deriveAbilities(c.clauses, "Hardened Scales", c.texts, undefined, text);
  const heard = abilities.filter((a) => a.replacement === true);
  expect(heard.length).toBeGreaterThan(0);
  for (const a of heard) expect(a.change).toEqual({ op: "plus", value: 1 });
});

test("CR 106.12a and 104.3: 'tapped for mana' is refused, and 'loses the game' is read as loses-game, never as lose-life", () => {
  const mana = clause("Whenever a land is tapped for mana, add an additional {G}.", "add-mana", "{G}", { event: "taps", subject: "a land", control: "any" });
  expect(deriveAbilities(mana.clauses, "Mana Reflection", mana.texts, undefined, mana.texts[1]).unknownTriggers).toContain("taps-for-mana");
  const lose = clause("Whenever a player loses the game, draw a card.", "draw", "a card", { event: "life-lost", subject: "a player", control: "any" });
  const out = deriveAbilities(lose.clauses, "Ramses", lose.texts, undefined, lose.texts[1]);
  expect(out.abilities[0]?.trigger?.verbs).toEqual(["loses-game"]);
});

test("CR 603.8 and 603.12: a state trigger and a reflexive trigger refuse into unknownTriggers, forming no edge", () => {
  for (const [event, text] of [["state", "When you control no Islands, sacrifice this creature."], ["reflexive", "When you do, draw a card."]] as const) {
    const c = clause(text, "draw", "a card", { event, subject: "you control no Islands" });
    const out = deriveAbilities(c.clauses, "Seasinger", c.texts, undefined, text);
    expect(out.unknownTriggers).toContain(event);
    expect(out.abilities.every((a) => a.trigger === undefined)).toBe(true);
  }
});
