/** VERB ACCOUNTING (roadmap AC8, owner ruling 2026-09-08 "every event matters"). Every clause verb
 *  the prompt can say is accounted for in exactly one way, and `verb-accounting.test.ts` fails on
 *  anything else:
 *
 *    EMITS         — `actionEmits` produces an engine event for it (computed, never listed);
 *    NOT AN EVENT  — a rules reading of why nothing can trigger on it, in `NOT_AN_EVENT` below;
 *    OPEN          — the rules let a trigger watch it and the engine emits nothing yet, in `OPEN`
 *                    with the card count from `research/tagger/dropped-action-census.ts`.
 *
 *  The OPEN count is a ratchet in both directions: the census exits non-zero when a re-run drops
 *  MORE cards for an OPEN verb, and the test fails the moment an OPEN verb starts emitting, so the
 *  gain has to be banked by moving the row. Counts are commander-legal cards whose action derived
 *  neither a kind nor an emit, measured 2026-09-09 over 32,277 clause docs (65,810 actions,
 *  13,084 dropped, 19.9%). Ordered by the rulebook, not by size: the queue is AC11. */

/** A statement of state, permission or modification. Nothing can trigger on it (CR 603.2 needs an
 *  event or a game state CHANGING), and the reading says which rule makes it so. */
export const NOT_AN_EVENT: Record<string, string> = {
  cant: "a restriction (CR 614.17); 2,397 cards, and 'whenever a creature can't attack' is not a sentence the rules allow",
  "cost-modify": "a continuous effect on costs (601.2f) — the tax and reduction ROLES, ruled not pairwise 2026-08-16",
  "modify-pt": "a continuous effect (611); the kind `pump` is the consumer-side reading",
  "grant-ability": "a continuous effect (611); `keyword-grant` is the kind",
  animate: "a type change is a continuous effect (611); no card prints 'whenever a permanent becomes a creature'",
  emblem: "getting an emblem (114) has no printed trigger head; the emblem's own abilities are their own clauses",
  "trigger-again": "603.2d: makes ANOTHER ability trigger again; not an event of its own (`trigger-doubling` is the kind)",
  "add-mana": "the event is the permanent being tapped for it (106.12a, `tapped-for-mana`); 'whenever you add mana' is printed by 0 cards",
  "set-life": "119.5: the change it causes is a gain or a loss; no card triggers on a life total being SET",
  "win-game": "104.2 ends the game; nothing can trigger after it. 0 corpus heads",
  "extra-turn": "500.7: the extra turn's own steps are the events (`untap-step`, `upkeep`)",
  "extra-combat": "500.8: `begin-combat` is the event of any combat phase, extra or not",
  "extra-phase": "500.8/500.9: the added phase's own step words are the events",
};

/** Events the rules let a trigger watch, with no emit yet. Value = cards dropped, the ratchet. */
export const OPEN: Record<string, { cards: number; note: string }> = {
  // --- CR 1xx: objects, mana, players
  "remove-counter": { cards: 590, note: "CR 122; `counter-removed` is the trigger word (18 consumers)" },
  "lose-game": { cards: 42, note: "CR 104.3; `loses-game` (10 consumers)" },
  // --- CR 4xx / 7xx: zones and objects
  shuffle: { cards: 1157, note: "CR 701.20; `shuffled` (15 consumers)" },
  play: { cards: 250, note: "CR 305.1 / 116.2a; `play` (35). `land-play` exists as an engine verb and is supplied by IMPLIED events, not by this action" },
  transform: { cards: 286, note: "CR 712; `transform` (36 consumers)" },
  "turn-face-up": { cards: 0, note: "CR 708; `turned-face-up` (114 consumers!). Has the kind `animate`, so never dropped, and still emits nothing" },
  copy: { cards: 0, note: "CR 707; `copy` (3). Has the kind `clone`, emits nothing" },
  reveal: { cards: 0, note: "CR 701.15; `reveal` (8). Never dropped, emits nothing" },
  amass: { cards: 0, note: "CR 701.44; `amass` (26 consumers). Has the kind `counter-placement`, emits nothing — the Army token and its counters are the AC11 row" },
  attach: { cards: 296, note: "CR 701.3; `attached` (11)" },
  unattach: { cards: 4, note: "CR 701.3d; `unattached` (4)" },
  "gain-control": { cards: 369, note: "CR 611 control change; `gains-control` (13)" },
  "phase-out": { cards: 50, note: "CR 702.26; `phases-out` (3)" },
  regenerate: { cards: 268, note: "CR 701.19; `regenerate` (1). A shield, so the emit is the SHIELD going up, not a tap" },
  prevent: { cards: 570, note: "CR 615.13; `prevented` (16)" },
  exchange: { cards: 67, note: "CR 701.10; `exchange`" },
  double: { cards: 58, note: "CR 701.9; `double`" },
  triple: { cards: 2, note: "CR 701.9; `triple`" },
  // --- CR 701 keyword actions the rules give no primitive (recorded, emit nothing)
  goad: { cards: 95, note: "701.15 status; `goad`" },
  exert: { cards: 28, note: "701.43 status; `exert`" },
  detain: { cards: 12, note: "701.35 status; `detain`" },
  suspect: { cards: 17, note: "701.60 status; `suspect`" },
  harness: { cards: 2, note: "701.64; `harness`" },
  vote: { cards: 28, note: "701.38; `vote` (3 'finish voting' consumers)" },
  clash: { cards: 29, note: "701.30; `clash` (12)" },
  fateseal: { cards: 3, note: "701.29; `fateseal`" },
  behold: { cards: 15, note: "701.4; `behold`" },
  heal: { cards: 1, note: "701.69; `heal`" },
  convert: { cards: 16, note: "701.28; `convert`" },
  explore: { cards: 40, note: "701.44 conditional outcome; `explore` (24)" },
  endure: { cards: 10, note: "701.63 conditional; `endure`" },
  learn: { cards: 21, note: "701.48 conditional; `learn`" },
  forage: { cards: 5, note: "701.61 conditional; `forage` (4)" },
  "time-travel": { cards: 9, note: "701.56 conditional; `time-travel`" },
  "collect-evidence": { cards: 16, note: "701.59; `collect-evidence`" },
  "venture-into-the-dungeon": { cards: 37, note: "701.49; `venture-into-the-dungeon`, `dungeon-completed` (5)" },
  "face-a-villainous-choice": { cards: 13, note: "701.55; a choice wrapper" },
  airbend: { cards: 13, note: "701.65 exiles; `airbend`" },
  waterbend: { cards: 10, note: "701.67 a cost payment; `waterbend`" },
  foretell: { cards: 1, note: "702.143; `foretell` (1)" },
  // --- CR 705 / 725-731 designations
  "flip-coin": { cards: 65, note: "CR 705; `flip-coin` (27 flip, 6 'win a flip')" },
  monarch: { cards: 55, note: "CR 725; `monarch` (27)" },
  initiative: { cards: 23, note: "CR 726; `initiative` (20)" },
  "city-blessing": { cards: 2, note: "CR 702.131; `city-blessing`" },
  "ring-tempts": { cards: 49, note: "CR 701.54; `ring-tempts` (19)" },
};

/** Every engine event -> the clause word a consumer says. The reverse of `CLAUSE_TRIGGER_TO_VERB`
 *  and `VERB_ALIASES`, kept explicit so a producer can never exist without a consumer word. */
export const ENGINE_TO_TRIGGER: Record<string, string> = {
  enters: "enters", "enters-graveyard": "put-into-graveyard", dies: "dies", leaves: "leaves", cast: "cast",
  attacks: "attacks", taps: "taps", "non-combat-damage": "damage-dealt", "combat-damage": "damage-dealt",
  draw: "draw", discard: "discarded", mill: "milled", "gain-life": "life-gained", "lose-life": "life-lost",
  sacrifice: "sacrificed", "create-token": "create", "counter-added": "counter-added", "land-play": "play",
  untaps: "untaps", proliferate: "proliferate", unlock: "unlocked", upkeep: "upkeep", "begin-combat": "begin-combat",
  "end-step": "end-step", "dice-rolled": "dice-rolled", scry: "scry", surveil: "surveil", search: "search",
  "counter-spell": "countered",
};

/** TRIGGERS words that map to NO engine verb, each with the reason, so `unknownTriggers` at runtime
 *  is always a word this file already knows about. A word that starts mapping fails the test until
 *  it is removed here — the gain is banked, not waved through. */
const PHASE_WORDS = ["draw-step", "main-phase", "combat-damage-step", "untap-step", "declare-attackers", "declare-blockers", "end-of-combat", "cleanup"];
const TEXT_SPLIT = ["damage-dealt"];
/** The trigger side of a verb in OPEN (or its passive spelling): the emit is the queue item. */
const AWAITING_EMIT = ["transform", "copy", "reveal", "attached", "unattached", "gains-control", "phases-out", "regenerate",
  "prevented", "exchange", "double", "triple", "goad", "exert", "detain", "suspect", "harness", "vote", "clash", "fateseal",
  "behold", "heal", "convert", "explore", "endure", "learn", "forage", "time-travel", "collect-evidence",
  "venture-into-the-dungeon", "face-a-villainous-choice", "airbend", "waterbend", "foretell", "flip-coin", "monarch",
  "initiative", "city-blessing", "ring-tempts", "shuffled", "play", "turned-face-up", "counter-removed", "loses-game",
  "roll-dice", "dungeon-completed"];
/** Keyword actions whose PRIMITIVE is emitted (connive emits draw+discard) while the word itself
 *  waits for an emit row named after the action, so "whenever a creature connives" can join. */
const PRIMITIVE_EMITTED = ["connive", "recruit", "bolster", "support", "adapt", "monstrosity", "blight", "investigate",
  "populate", "incubate", "manifest", "discover", "meld", "cloak", "manifest-dread", "earthbend", "amass", "fight",
  "becomes-monstrous"];
/** Events no action supplies: the game or an opponent does. Refused by design, never near-missed. */
const NO_PRODUCER = ["blocks", "becomes-blocked", "becomes-target", "level-up", "chapter", "crime", "expend", "descended",
  "day-night", "activate", "exiled", "phases-in", "loses-control", "becomes-crewed", "tapped-for-mana", "cycled",
  "mutates", "exploit", "firebend", "reflexive", "state", "mana-spent", "damaged", "returned-to-hand", "put-into-library",
  "becomes-renowned", "becomes-saddled", "plotted", "give-gift", "mentors", "solved", "resolves", "evolve"];
export const TRIGGER_REFUSED: Record<string, string> = Object.fromEntries([
  ...PHASE_WORDS.map((w) => [w, "a phase or step: the turn supplies it, no card emits it"]),
  ...TEXT_SPLIT.map((w) => [w, "split into combat-damage / non-combat-damage by derive.ts reading the clause text"]),
  ...AWAITING_EMIT.map((w) => [w, "the consumer side of an OPEN verb; joins when the emit row lands (AC11)"]),
  ...PRIMITIVE_EMITTED.map((w) => [w, "the action emits its rules primitive; an emit named after the action itself is the AC11 row"]),
  ...NO_PRODUCER.map((w) => [w, "no action supplies it yet (a state, an opponent's act, or a keyword's own trigger); refused into unknownTriggers rather than near-missed"]),
]);
