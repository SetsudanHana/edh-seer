/** IS THE TRIGGER VOCABULARY COMPLETE AGAINST THE RULES? The `cr-completeness` ratchet one layer up:
 *  that one holds `VERBS` against CR 701; this holds `TRIGGERS` against what CR 603.2 lets a
 *  triggered ability watch — an event or a game state, wherever in the rulebook it is defined.
 *
 *  Built for the 2026-09-09 buy of the remaining 10,615 commander-legal cards (roadmap AC1–AC4).
 *  Normalization is a one-way ratchet: a word the prompt lacks at purchase is frozen out of every
 *  card bought without it, and the emblem taught that a sweep testing PRESENCE ("is there a word")
 *  is not a sweep testing the RULES ("is every rule-defined event a word"). So the list here comes
 *  from the rulebook, the count from the corpus, and the verdict is written down:
 *
 *    - `word`    — TRIGGERS carries it (and it must really be there);
 *    - `verdict` — NOT AN EVENT with a rules reading, or EXCLUDED on legality;
 *    - neither, with `n` corpus cards printing the head — FAILS. That is the emblem test.
 *
 *  `n` is commander-legal cards printing the trigger head, measured 2026-09-09 by
 *  `research/tagger/trigger-event-probe.ts` and `trigger-head-census.ts` (Mongo; this test runs in
 *  a fresh clone and cannot re-measure). A row with a word needs no count.
 *
 *  Both directions ratchet: a TRIGGERS member with no row here is a word without a rule, and fails
 *  too — that is how `roll-dice` beside `dice-rolled` gets written down as an alias rather than
 *  silently doubling an event. */
import { expect, test } from "vitest";
import { SYSTEM, TRIGGERS, VERBS } from "../normalize-prompt.js";
import { normalizeTriggerVerb } from "./derive.js";
import { EXCLUDED_701 } from "./cr-exclusions.js";
import crKeywords from "./cr-keywords.json" with { type: "json" };

interface Row { rule: string; event: string; word?: string; verdict?: string; n?: number }
const row = (rule: string, event: string, word: string, n?: number): Row => ({ rule, event, word, ...(n === undefined ? {} : { n }) });
const notEvent = (rule: string, event: string, why: string, n = 0): Row => ({ rule, event, verdict: `NOT AN EVENT: ${why}`, n });
const excluded = (rule: string, event: string, why: string, n = 0): Row => ({ rule, event, verdict: `EXCLUDED: ${why}`, n });

/** CR 701 keyword actions as EVENTS ("whenever a player scries"). Our spelling where it differs
 *  from the CR heading; the passive form for something done TO an object, active for something a
 *  player does — the naming split TRIGGERS itself records. */
const TRIGGER_ALIASES_701: Record<string, string> = {
  counter: "countered",
  "tap and untap": "taps",
  attach: "attached",
  exile: "exiled",
  sacrifice: "sacrificed",
  discard: "discarded",
  mill: "milled",
  shuffle: "shuffled",
  // Destroying a permanent puts it into its owner's graveyard from the battlefield (701.7a), which
  // IS `dies` (700.4). "destroyed" reads zero corpus cards; TRIGGERS records the refusal.
  destroy: "dies",
  "venture into the dungeon": "venture-into-the-dungeon",
  "the ring tempts you": "ring-tempts",
  "time travel": "time-travel",
  "collect evidence": "collect-evidence",
  "manifest dread": "manifest-dread",
  "face a villainous choice": "face-a-villainous-choice",
};
/** `activate` is excluded as a VERB (a card never instructs it) and is a real TRIGGER (CR 602,
 *  "whenever you activate an ability" — 36 corpus cards). */
const EXCLUDED_701_AS_TRIGGER = Object.fromEntries(Object.entries(EXCLUDED_701).filter(([k]) => k !== "activate"));

const from701: Row[] = crKeywords.actions.map((raw) => {
  const action = raw.toLowerCase();
  if (action in EXCLUDED_701_AS_TRIGGER) return excluded(`701 ${raw}`, raw, EXCLUDED_701_AS_TRIGGER[action]!);
  return row(`701 ${raw}`, `whenever a player ${action}s`, TRIGGER_ALIASES_701[action] ?? action);
});

const CR_EVENTS: Row[] = [
  ...from701,
  row("701.21", "becomes untapped (the other half of 'tap and untap')", "untaps"),
  // --- the turn, CR 500–514. Nothing emits a phase; the turn supplies it.
  row("502", "untap step", "untap-step"),
  row("503", "upkeep step", "upkeep"),
  row("504", "draw step", "draw-step"),
  row("505", "main phase (precombat, postcombat)", "main-phase"),
  row("507", "beginning of combat", "begin-combat"),
  row("508", "declare attackers step", "declare-attackers"),
  row("508.1", "a creature attacks (attackers declared)", "attacks"),
  row("509", "declare blockers step", "declare-blockers"),
  row("509.1", "a creature blocks", "blocks"),
  row("509.1h", "a creature becomes blocked", "becomes-blocked"),
  row("510", "combat damage step", "combat-damage-step"),
  row("511", "end of combat step", "end-of-combat"),
  row("513", "end step", "end-step"),
  row("514", "cleanup step", "cleanup"),
  notEvent("500.7", "an extra turn begins", "no card prints 'whenever you take an extra turn'; the turn's own steps (untap-step, upkeep) are the events. 0 corpus heads"),
  notEvent("500.8", "an extra phase or combat begins", "begin-combat is the event of any combat phase, extra or not. 0 corpus heads"),
  // --- objects and zones, CR 1xx / 4xx / 6xx / 7xx.
  row("603.6a", "enters the battlefield", "enters"),
  row("700.4", "dies (battlefield -> graveyard)", "dies"),
  row("603.6c", "leaves the battlefield", "leaves"),
  row("404", "put into a graveyard from anywhere", "put-into-graveyard"),
  row("401", "put into a library from anywhere", "put-into-library", 2),
  row("402", "returned to hand", "returned-to-hand", 5),
  row("601", "a spell is cast", "cast"),
  row("305.1 / 116.2a", "a land is played, a card is played from exile", "play"),
  row("707", "a spell or ability is copied", "copy"),
  row("708 / 116.2b", "turned face up", "turned-face-up"),
  row("701.3d", "becomes unattached", "unattached", 4),
  row("611.1", "control changes: gains control", "gains-control"),
  row("611.1", "control changes: loses control", "loses-control"),
  row("702.26", "phases out", "phases-out"),
  row("702.26", "phases in", "phases-in"),
  row("712", "transforms", "transform"),
  row("106.12a", "tapped for mana", "tapped-for-mana"),
  notEvent("611", "becomes a creature (animate, ensoul)", "a type change is a continuous effect; no card prints 'whenever a permanent becomes a creature'. 0 corpus heads"),
  notEvent("611", "gains an ability / gets +N/+N", "continuous effects, not events; no printed head. 0 corpus heads"),
  notEvent("614", "a replacement effect applies", "a replacement effect has no trigger of its own (prompt rule); the replaced event is the trigger"),
  // --- players, CR 1xx.
  row("119", "gains life", "life-gained"),
  row("119", "loses life", "life-lost"),
  row("104.3", "loses the game", "loses-game", 10),
  row("120", "deals damage", "damage-dealt"),
  row("120", "is dealt damage", "damaged", 122),
  row("615.13", "damage is prevented", "prevented"),
  row("121", "draws a card", "draw"),
  row("122", "a counter is put on", "counter-added"),
  row("122", "a counter is removed", "counter-removed", 18),
  row("106.4 / 118.3a", "mana is spent or paid", "mana-spent", 18),
  notEvent("106.4", "mana is added", "every printed head is a permanent tapped for mana (Caged Sun, Dictate of Karametra), which tapped-for-mana spells. 0 heads beyond it"),
  notEvent("107.14", "gets energy", "an ACTION, and CR 107.14 says what it is: a counter. add-counter with object energy (prompt rule); no card triggers on getting energy. 0 heads"),
  notEvent("119.5", "life total becomes N", "set-life is an action; no card prints 'whenever a life total is set'. 0 heads"),
  notEvent("114", "gets an emblem", "no card prints 'whenever you get an emblem'. 0 heads"),
  row("705", "flips a coin, wins or loses a flip", "flip-coin"),
  row("706", "rolls a die", "dice-rolled"),
  row("706", "rolls a die (alias of dice-rolled, both legal; recorded, not doubled)", "roll-dice"),
  row("725", "becomes the monarch", "monarch"),
  row("726", "takes the initiative", "initiative"),
  row("702.131", "gains the city's blessing (ascend)", "city-blessing"),
  row("731", "day becomes night / night becomes day", "day-night"),
  row("309 / 701.49", "completes a dungeon", "dungeon-completed"),
  row("700.13", "commits a crime", "crime"),
  row("700.14", "expends N", "expend"),
  row("700.11", "descended (a permanent card put into the graveyard this turn)", "descended"),
  row("602", "activates an ability", "activate"),
  row("608", "a spell or ability resolves", "resolves", 2),
  row("115", "becomes the target", "becomes-target"),
  row("702.21", "ward: becomes the target of an opponent's spell (same event)", "becomes-target"),
  row("603.8", "a game state becomes true (state trigger)", "state", 50),
  row("603.12c", "'when you do' (reflexive trigger)", "reflexive", 252),
  // --- keyword abilities whose rule defines a trigger head (the firebend precedent, CR 702).
  row("702.29", "cycles", "cycled"),
  row("702.87", "level up (a Class becomes level N, a leveler levels)", "level-up"),
  row("702.110", "exploits a creature", "exploit"),
  row("702.112", "becomes renowned", "becomes-renowned", 2),
  row("702.122e", "becomes crewed", "becomes-crewed"),
  row("702.134c", "mentors a creature", "mentors", 1),
  row("702.140d", "mutates", "mutates"),
  row("702.143", "foretells a card", "foretell", 1),
  row("702.170", "becomes plotted", "plotted", 2),
  row("702.171", "becomes saddled", "becomes-saddled", 1),
  row("702.174c", "gives a gift", "give-gift", 1),
  row("702.189b", "firebends", "firebend"),
  row("701.37", "becomes monstrous (the event side of monstrosity)", "becomes-monstrous"),
  row("714", "a Saga chapter", "chapter"),
  row("709.5", "a Room is unlocked", "unlocked"),
  row("719", "solves a Case", "solved", 1),
  row("701.54a", "chooses a Ring-bearer (part of the Ring tempting)", "ring-tempts"),
  // --- excluded on legality, never on count.
  excluded("123", "puts a sticker on", "Unfinity sticker sheets, the same footing as Attractions", 9),
  excluded("901", "chaos ensues / planeswalks", "Planechase; no plane is ever in a decklist", 238),
  excluded("904", "a scheme is set in motion", "Archenemy; never in a decklist", 84),
  excluded("702 (Alchemy)", "specializes", "Alchemy-only, digital", 42),
];

const words = new Set(TRIGGERS);

test("every rule-defined event with corpus cards has a word or a written verdict", () => {
  const gaps = CR_EVENTS.filter((r) => !r.word && !r.verdict && (r.n ?? 0) > 0);
  expect(gaps.map((r) => `${r.rule} ${r.event} (${r.n} cards)`), "events the prompt cannot say").toEqual([]);
  // A row with neither a word nor a count is an unmeasured claim, not a verdict.
  expect(CR_EVENTS.filter((r) => !r.word && r.n === undefined).map((r) => r.event)).toEqual([]);
});

test("every word a row names is really in TRIGGERS", () => {
  const missing = CR_EVENTS.filter((r) => r.word && !words.has(r.word)).map((r) => `${r.event} -> ${r.word}`);
  expect(missing).toEqual([]);
});

test("every TRIGGERS member has a rule — a word without one is an invented event", () => {
  const ruled = new Set(CR_EVENTS.map((r) => r.word).filter(Boolean));
  const unruled = TRIGGERS.filter((t) => t !== "other" && t !== "none" && !ruled.has(t));
  expect(unruled, "TRIGGERS members with no CR_EVENTS row").toEqual([]);
});

test("the exclusions stay honest — every excluded 701 action is still in the rules", () => {
  const actions = new Set(crKeywords.actions.map((a) => a.toLowerCase()));
  for (const k of Object.keys(EXCLUDED_701_AS_TRIGGER)) expect(actions.has(k), k).toBe(true);
});

/** AC4: VERBS and TRIGGERS paired both ways. Every VERBS member is either the same word in
 *  TRIGGERS, mapped to its event spelling here, or accounted for with a reading. */
const VERB_TO_TRIGGER: Record<string, string> = {
  destroy: "dies",
  tap: "taps",
  untap: "untaps",
  sacrifice: "sacrificed",
  discard: "discarded",
  mill: "milled",
  exile: "exiled",
  "counter-spell": "countered",
  "gain-life": "life-gained",
  "lose-life": "life-lost",
  "deal-damage": "damage-dealt",
  "add-counter": "counter-added",
  "remove-counter": "counter-removed",
  prevent: "prevented",
  shuffle: "shuffled",
  attach: "attached",
  "turn-face-up": "turned-face-up",
  "gain-control": "gains-control",
  "phase-out": "phases-out",
  "add-mana": "tapped-for-mana",
  "roll-dice": "dice-rolled",
  monstrosity: "becomes-monstrous",
  "extra-turn": "untap-step",
  "extra-combat": "begin-combat",
  "extra-phase": "main-phase",
};
const VERB_NO_TRIGGER: Record<string, string> = {
  put: "named by destination: enters, put-into-graveyard, put-into-library, returned-to-hand",
  return: "named by destination, as put",
  "grant-ability": "a continuous effect (611), no printed head",
  "modify-pt": "a continuous effect (611), no printed head",
  cant: "a restriction (614.17), nothing can trigger on it",
  "cost-modify": "a continuous effect on costs (601.2f), no printed head",
  "set-life": "no printed head; the resulting gain or loss is life-gained/life-lost (119.5)",
  emblem: "no printed head (114)",
  animate: "a type change is a continuous effect (611), no printed head",
  "trigger-again": "603.2d: makes another trigger fire again; not an event of its own",
  double: "CR 701 action with a TRIGGERS word of the same name",
};

test("every VERB the rules let a trigger watch has a TRIGGERS word", () => {
  const unpaired = VERBS.filter((v) => v !== "other" && v !== "none")
    .filter((v) => !words.has(v) && !(v in VERB_TO_TRIGGER) && !(v in VERB_NO_TRIGGER));
  expect(unpaired, "VERBS members with no trigger word and no reading").toEqual([]);
  for (const [v, t] of Object.entries(VERB_TO_TRIGGER)) {
    expect(VERBS, `${v} is not a VERB`).toContain(v);
    expect(words.has(t), `${v} -> ${t}, but "${t}" is not in TRIGGERS`).toBe(true);
  }
  for (const v of Object.keys(VERB_NO_TRIGGER)) expect(VERBS, `${v} is not a VERB`).toContain(v);
});

/** AC3: every trigger word whose English is a substring of another event's English is named in the
 *  prompt's HOMONYMS rule, so the model is told both readings rather than picking the nearer word.
 *  Baral ("counters a spell" -> counter-added) is the witness. */
test("every homonym pair is in TRIGGERS and named in the prompt's HOMONYMS rule", () => {
  const families = [
    ["counter-added", "counter-removed", "countered"],
    ["damage-dealt", "damaged"],
    ["taps", "tapped-for-mana", "mana-spent"],
    ["exiled", "put-into-graveyard", "put-into-library", "returned-to-hand", "dies"],
    ["cast", "copy", "play"],
    ["gains-control", "loses-control"], ["attached", "unattached"], ["phases-in", "phases-out"],
    ["transform", "turned-face-up"],
    ["life-lost", "loses-game"],
  ];
  const rule = SYSTEM.slice(SYSTEM.indexOf("- HOMONYMS."), SYSTEM.indexOf("- ENERGY."));
  for (const family of families) for (const w of family) {
    expect(words.has(w), `${w} is not in TRIGGERS`).toBe(true);
    expect(rule.includes(w), `HOMONYMS rule does not name ${w}`).toBe(true);
  }
  for (const w of ["reflexive", "state"]) {
    expect(words.has(w)).toBe(true);
    expect(SYSTEM.includes(`event "${w}"`), `prompt rule for ${w}`).toBe(true);
  }
});

/** A new word maps to NO engine verb until an emit exists for it: it must refuse into
 *  `unknownTriggers`, never near-miss. (`put-into-graveyard` -> `enters-graveyard` is the one word
 *  with a verb waiting, pinned in cr-completeness.test.ts.) */
test("the 2026-09-09 words refuse rather than near-miss", () => {
  const added = ["reflexive", "state", "counter-removed", "mana-spent", "damaged", "loses-game", "unattached",
    "returned-to-hand", "put-into-library", "becomes-renowned", "becomes-saddled", "plotted", "foretell",
    "give-gift", "mentors", "solved", "resolves"];
  for (const w of added) {
    expect(TRIGGERS, w).toContain(w);
    expect(normalizeTriggerVerb(w), `${w} must refuse, not map to a verb`).toBeNull();
  }
  expect(VERBS).toContain("foretell");
});
