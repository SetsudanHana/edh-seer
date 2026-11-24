import { SUBTYPE_TYPES } from "@edh-seer/tagger/subtypes";
import { isPutIntoGraveyardClass, type Tag } from "./tags.js";

/** ONE NAME PER KEY (#1170, owner 2026-11-24). `tagName` is the only function that turns a tag into
 *  the words a player reads: the deck's headline, the Plan's theme bars, the orbit disc, the card
 *  chips' fallback. It replaces three that disagreed -- `themeName` here, the web's `groupName`, and
 *  the display-time patches that made the two agree for the main theme only.
 *
 *  `describeTag` is NOT replaced. It names the MECHANISM and writes the sentence under every edge
 *  ("enchantments entering" is why two cards are joined); an edge reason saying "Enchantress" would be
 *  a category error. `tagName` names the THEME.
 *
 *  RESOLUTION ORDER: the exact table, the family rules (verb x subject), then a phrase built from the
 *  tag's own words. The last step never yields an identifier: no colon, no "any", no slug.
 *
 *  TWO DISTINCT KEYS NEVER SHARE A NAME (a test walks every VERB_VOCAB verb and the 972 keys of the 71
 *  calibration decks). The one deliberate merge is #543, the owner's ruling that instants and
 *  sorceries are one group. The matcher's `themeSubjectKey` writes the one key `instant-sorcery` itself
 *  (#1170 PR 3), so the structured pipeline never sends the two. THE FOLD BELOW STAYS for the FLAT engine
 *  (`patterns.ts`, which the CLI still runs) that keys `cast:instant` and `cast:sorcery`.
 *
 *  THE OWNER'S WORDS: "no magic player uses phrasing like 'Creatures Entering'" (2026-09-27, #616). A
 *  theme is named the way a deck tech names it -- Landfall, Enchantress, Aristocrats, Anthems -- and
 *  where no such word exists, by what the cards do: "Artifact ETBs", "Cast triggers". */
export const THEME_NAMES: Record<string, string> = {
  // The named archetypes a player would recognise from EDHREC's own theme list.
  "dies:creature": "Aristocrats",
  "enters:enchantment": "Enchantress",
  "enters:land": "Landfall",
  "cast:instant-sorcery": "Spellslinger",
  "create-token:creature": "Tokens",
  "counter-added:creature": "+1/+1 counters",
  "counter-added:any": "Counters matter",
  "proliferate:any": "Proliferate",
  "enters:planeswalker": "Superfriends",
  "enters:legendary": "Legends matter",
  "enters:aura": "Auras",
  "enters:equipment": "Equipment",
  "enters:vehicle": "Vehicles",
  "enters:saga": "Sagas",
  "enters:curse": "Curses",
  "sacrifice:creature": "Sacrifice",
  "lose-life:any": "Life loss",
  "lose-life:opp": "Drain",
  "gain-life:any": "Lifegain",
  "draw:any": "Card draw",
  "discard:any": "Discard",
  "mill:any": "Mill",
  "combat-damage:creature": "Combat damage triggers",
  "non-combat-damage:any": "Burn",
  "upkeep:any": "Upkeep triggers",
  "enters:permanent": "ETB triggers",
  "cast:spell": "Cast triggers",
  "cast:-creature": "Noncreature spells",
  "static:pump": "Anthems",
  "static:keyword-grant": "Keyword granting",
  "static:type-grant": "Adds creature types",
  "static:cost-reduction": "Cost reducers",
  "static:speed-increase": "Haste enablers",
  "static:damage-multiplier": "Damage doublers",
  "static:tax": "Taxes",
  "static:copy-spell": "Spell copiers",
  "static:clone": "Clones",
  // EVERY `EFFECT_KINDS` MEMBER, in a player's words (#1170 review): a static ability's kind is the whole
  // content of its tag, and "<slug> effects" read "Base pt set effects". A test fails on a kind with no entry.
  "static:token-generation": "Token engines",
  "static:damage": "Damage engines",
  "static:player-life-loss": "Life-loss engines",
  "static:lifegain": "Lifegain engines",
  "static:drain": "Drain engines",
  "static:draw-card": "Card draw engines",
  "static:forced-sacrifice": "Edicts",
  "static:debuff": "Debuffs",
  "static:ability-loss": "Ability removal",
  "static:trigger-doubling": "Doubling triggers",
  "static:graveyard-recursion": "Recursion engines",
  "static:token-doubling": "Token doublers",
  "static:scry": "Scry engines",
  "static:surveil": "Surveil engines",
  "static:mill": "Mill engines",
  "static:search": "Tutor engines",
  "static:top-set": "Top-of-library setup",
  "static:counter-placement": "Counter placers",
  "static:enters-with-counters": "Extra counters on entry",
  "static:mana-generation": "Mana engines",
  "static:fast-mana": "Mana accelerants",
  "static:ritual": "Rituals",
  "static:copy-ability": "Ability copying",
  "static:speed": "Speed boosters",
  "static:flicker": "Blink effects",
  "static:animate": "Animators",
  "static:untap": "Untappers",
  "static:proliferate": "Proliferate engines",
  "static:graveyard-hate": "Graveyard hosers",
  "static:exile-processing": "Exile processors",
  "static:extra-combat": "Extra combats",
  "static:win-game": "Alternate wins",
  "static:extra-turn": "Extra turns",
  "static:extra-phase": "Extra phases",
  "static:emblem": "Emblem makers",
  "static:bounce": "Bouncers",
  "static:play-from-top": "Top-of-library play",
  "static:extra-loyalty": "Extra loyalty activations",
  "static:retarget": "Retargeting",
  "static:evasion": "Evasive creatures",
  "static:restriction": "Restrictions",
  "static:targeting-ban": "Targeting protection",
  "static:graveyard-lock": "Graveyard locks",
  "static:counter-immunity": "Uncounterable spells",
  "static:player-lock": "Player locks",
  "static:trigger-suppression": "Trigger stoppers",
  "static:untap-denial": "Untap stoppers",
  "static:prevention": "Prevention shields",
  "static:damage-change": "Damage changers",
  "static:life-total-set": "Life total setting",
  "static:to-hand": "Returning to hand",
  "static:base-pt-set": "Base power/toughness setting",
  "fodder:creature": "Sac fodder",
  "graveyard-recursion:creature": "Reanimator",
  "graveyard-recursion:any": "Recursion",
  "graveyard-intercept:any": "Playing their exiled cards",
  "doubles:enters": "ETB doublers",
  "copies:triggered": "Trigger copiers",
  "copies:activated": "Ability copiers",
  "creates:treasure": "Treasure makers",
  "creates:emblem": "Emblems",
  "scales:land": "Lands matter",
  "scales:party": "Party",
  // Per-life-lost scaling (Rowan, Rakdos): a count of life, not of a type, so it is no tribe (`edges.ts` lifeLostEdges).
  "scales:life-lost": "Life loss matters",
  // Urza's Mine, Tower and Power-Plant are one land type (CR 205.3i); the apostrophe is part of the word.
  "scales:urza's": "Urza's lands matter",
  "scales:donated": "Donate",
  "condition:party": "Party synergy",
  "keyword-grant:spell": "Spell keyword granting",
  "keyword-grant:instant-sorcery": "Instant and sorcery keyword granting",
  "attacks:creature": "Attack triggers",
  "blocks:creature": "Block triggers",
  "becomes-blocked:creature": "Becomes-blocked triggers",
  "ramp-target:any": "Ramp",
  "ramp-target:land": "Land ramp",
  "ramp-target:basic": "Basic land ramp",
  // A deck built to make its entry triggers happen more than once. EDHREC files the effects that do
  // it under Blink; the engine's own phrase, "re-firing entry triggers", says the mechanism.
  "etb-refire": "Blink",
  meld: "Melding cards",
};

const CARD_TYPES = new Set(["creature", "land", "artifact", "enchantment", "instant", "sorcery", "planeswalker", "permanent", "spell", "battle"]);

/** Title case for words as they are printed in a name: "time lord" -> "Time Lord". */
const titleCase = (s: string): string =>
  s.replace(/(^|[ -])([a-z])/g, (_m, sep: string, c: string) => sep + c.toUpperCase());
const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const lower = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

/** A subject as the plural a player says: "creatures", "Clerics", "noncreature spells". */
export function pluralSubject(subject: string): string {
  if (!subject || subject === "any") return "cards";
  if (subject === "instant-sorcery") return "instants and sorceries";
  if (subject.startsWith("-")) return `non${subject.slice(1)} ${subject === "-land" ? "cards" : "spells"}`;
  // THE PARTY IS NOT A TYPE: `scales:party` (#490) counts up to one each of Cleric, Rogue, Warrior
  // and Wizard, and "Counts your Parties" read as a card type that does not exist.
  if (subject === "party") return "party members";
  const w = CARD_TYPES.has(subject) ? subject : capital(subject);
  if (w === "sorcery") return "sorceries";
  if (w.toLowerCase() === "locus") return w === "locus" ? "loci" : "Loci";
  // "Urza's" is a possessive, not a noun to pluralise.
  if (/'s$/i.test(w)) return w;
  if (/(ch|sh|s|x)$/i.test(w)) return `${w}es`;
  if (/[^aeiou]y$/i.test(w)) return `${w.slice(0, -1)}ies`;
  if (/f$/i.test(w)) return `${w.slice(0, -1)}ves`;
  return `${w}s`;
}

interface Subj {
  /** A class or creature type is named; `any` and the empty subject are not. */
  none: boolean;
  tribe: boolean;
  /** "Artifact", "Noncreature", "Instant and sorcery", "Time Lord". */
  S: string;
  /** "artifacts" / "Clerics". */
  p: string;
  /** "Artifacts" / "Clerics". */
  P: string;
}

/** A TRIBE IS A CREATURE TYPE (CR 205.3m), decided by the tagger's authoritative subtype map and never
 *  by the shape of the word: "life-lost", "Urza's" and the land types gate, locus and town are not
 *  tribes and read "Gate typal" before this. A Chandra is a planeswalker type, not a tribe. */
const isCreatureType = (sub: string): boolean => SUBTYPE_TYPES[sub]?.includes("creature") === true;

function subjectOf(sub: string): Subj {
  const none = sub === "" || sub === "any";
  if (sub === "__none__") return { none: false, tribe: false, S: "Unchosen type", p: "unchosen types", P: "Unchosen types" };
  const S = sub === "instant-sorcery" ? "Instant and sorcery" : sub.startsWith("-") ? `Non${sub.slice(1)}` : titleCase(sub);
  const p = pluralSubject(sub);
  return { none, tribe: isCreatureType(sub), S, p, P: capital(p) };
}

/** Verbs with no family rule of their own: the name with no subject, and the name once a subject
 *  narrows it ({S} Artifact, {P} Artifacts, {p} artifacts). A verb with no typed form reads
 *  "<S> <the bare name, lowercased>". Every `VERB_VOCAB` member is here, so a verb the engine grows
 *  fails the completeness test in `tag-names.test.ts` rather than shipping a slug. */
const VERBS: Record<string, [bare: string, typed?: string]> = {
  "enters-graveyard": ["Cards hitting the graveyard", "{P} hitting the graveyard"],
  "leaves-graveyard": ["Leaving the graveyard", "{P} leaving the graveyard"],
  leaves: ["Leaving the battlefield", "{P} leaving the battlefield"],
  taps: ["Tapping", "{P} tapping"],
  untaps: ["Untapping", "{P} untapping"],
  damaged: ["Being damaged", "{P} being damaged"],
  exiled: ["Exile", "{P} exiled"],
  draw: ["Card draw", "Drawing {p}"],
  discard: ["Discard", "{P} discarded"],
  mill: ["Mill", "{P} milled"],
  "gain-life": ["Lifegain", "{S} lifegain"],
  "lose-life": ["Life loss", "{S} life loss"],
  sacrifice: ["Anything sacrificed", "{S} sacrifice"],
  "land-play": ["Land drops", "{S} land drops"],
  unlock: ["Unlocking rooms", "Unlocking {p}"],
  upkeep: ["Upkeep triggers", "{S} upkeep triggers"],
  "begin-combat": ["Beginning-of-combat triggers", "{S} beginning-of-combat triggers"],
  "end-step": ["End-step triggers", "{S} end-step triggers"],
  "dice-rolled": ["Dice rolling", "Dice rolled for {p}"],
  scry: ["Scry", "Scrying for {p}"],
  surveil: ["Surveil", "Surveilling for {p}"],
  search: ["Library searching", "Searching for {p}"],
  "counter-spell": ["Counterspells", "{S} counterspells"],
  "loses-game": ["Losing the game", "{P} losing the game"],
  shuffle: ["Shuffling", "Shuffling {p}"],
  transform: ["Transforming", "{P} transforming"],
  "turned-face-up": ["Turning face up", "{P} turning face up"],
  copy: ["Copying", "Copying {p}"],
  reveal: ["Revealing", "Revealing {p}"],
  attached: ["Attaching", "{P} attached"],
  unattached: ["Unattaching", "{P} unattached"],
  "gains-control": ["Gaining control", "Gaining control of {p}"],
  "phases-out": ["Phasing out", "{P} phasing out"],
  regenerate: ["Regenerating", "Regenerating {p}"],
  prevented: ["Damage prevention", "Preventing damage to {p}"],
  exchange: ["Exchanging", "Exchanging {p}"],
  double: ["Doubling", "Doubling {p}"],
  triple: ["Tripling", "Tripling {p}"],
  goad: ["Goad", "Goading {p}"], exert: ["Exert", "Exerting {p}"], detain: ["Detain", "Detaining {p}"], suspect: ["Suspect", "Suspecting {p}"], harness: ["Harness", "Harnessing {p}"],
  vote: ["Voting", "Voting with {p}"], clash: ["Clash", "Clashing with {p}"], fateseal: ["Fateseal", "Fatesealing with {p}"], behold: ["Behold", "Beholding {p}"], heal: ["Healing", "Healing {p}"],
  convert: ["Convert", "Converting {p}"], explore: ["Explore", "{P} exploring"], endure: ["Endure", "{P} enduring"], learn: ["Learn", "Learning with {p}"], forage: ["Forage", "Foraging with {p}"],
  "time-travel": ["Time travel", "Time travel with {p}"], "collect-evidence": ["Collecting evidence", "Collecting evidence with {p}"],
  "venture-into-the-dungeon": ["Venturing into the dungeon", "Venturing into the dungeon with {p}"],
  "face-a-villainous-choice": ["Facing a villainous choice", "Villainous choices about {p}"],
  "face-a-dilemma": ["Facing a dilemma", "{P} facing a dilemma"],
  airbend: ["Airbend", "Airbending {p}"], waterbend: ["Waterbend", "Waterbending {p}"], foretell: ["Foretell", "Foretelling {p}"],
  "flip-coin": ["Coin flips", "Coin flips for {p}"], monarch: ["Monarch", "Monarch with {p}"], initiative: ["Initiative", "Initiative with {p}"],
  "city-blessing": ["City's blessing", "City's blessing with {p}"], "ring-tempts": ["The Ring tempting you", "The Ring tempting {p}"], prepared: ["Prepared", "{P} becoming prepared"],
  proliferate: ["Proliferate", "Proliferating {p}"],
  // The pass literals `edges.ts` writes itself (the reason tag's family is not a trigger verb).
  "recursion-target": ["Recursion targets", "{S} recursion targets"],
  tutor: ["Tutors", "{S} tutors"],
  fodder: ["General sacrifice fodder", "{S} fodder"],
  copies: ["Copy effects", "{S} copiers"],
  doubles: ["Trigger doublers", "{S} trigger doublers"],
  threshold: ["Graveyard matters", "{P} in the graveyard"],
  reuse: ["Blink and reanimate", "{S} blink"],
  prowess: ["Prowess", "Prowess on {p}"],
  cheat: ["Cheat into play", "Cheat {p} into play"],
  condition: ["Conditional cards", "{S} synergy"],
  flash: ["Flash", "{S} flash"],
  "keyword-grant": ["Granting keywords", "Granting keywords to {p}"],
  "play-from-top": ["Playing from the top", "Playing {p} from the top"],
  "exile-processing": ["Exile processing", "{S} exile processing"],
  "land-condition": ["Basic-land payoffs", "{S} land payoffs"],
  wincon: ["Win conditions", "{S} win conditions"],
  "extra-loyalty": ["Extra loyalty", "Extra loyalty for {p}"],
  imprint: ["Imprint", "Imprinting {p}"],
  pump: ["Pumping", "Pumping {p}"],
  clone: ["Cloning", "Cloning {p}"],
  "counter-removed": ["Removing counters", "Removing counters from {p}"],
  "graveyard-intercept": ["Playing their exiled cards", "Playing exiled {p} from their graveyard"],
  "non-combat-damage": ["Burn", "{S} non-combat damage"],
  // THE FLAT ENGINE'S LEGACY FAMILIES (`extractTags` -> `synergy.ts`): they read as their own words and
  // must not share a name with `enters:`, `create-token:` or `counter-added:`.
  tribe: ["Tribes", "{S} tribe"],
  "tribe-nontoken": ["Nontoken tribes", "Nontoken {S} tribe"],
  counter: ["Counter synergies", "{S} counter synergies"],
  token: ["Token synergies", "{S} token synergies"],
};

const fill = (tpl: string, s: Subj): string => tpl.replace("{S}", s.S).replace("{P}", s.P).replace("{p}", s.p);

/** The family rules: a verb whose subject changes the SHAPE of the name, not just a word in it.
 *  Null when the family has no special shape and the `VERBS` table decides. */
function familyRule(kind: string, sub: string, s: Subj): string | null {
  switch (kind) {
    case "scales":
      return s.tribe ? `${s.S} typal` : s.none ? "Cards matter" : `${s.P} matter`;
    case "enters":
      return s.none ? "Anything entering" : `${s.S} ETBs`;
    case "dies":
      if (s.none) return "Anything dying";
      return isPutIntoGraveyardClass(sub) ? `${s.P} to the graveyard` : `${s.S} deaths`;
    case "cast":
      return s.none ? "Casting anything" : `${s.S} spells`;
    case "attacks":
      return s.none ? "Attacks" : `${s.S} attacks`;
    case "blocks":
      return s.none ? "Blocks" : `${s.S} blocks`;
    case "becomes-blocked":
      return s.none ? "Becoming blocked" : `${s.S} becoming blocked`;
    case "combat-damage":
      return s.none ? "Combat damage" : `${s.S} combat damage`;
    case "counter-added":
      return s.none ? "Counters matter" : `Counters on ${s.p}`;
    case "create-token":
      // A deck making one KIND of token is named for the token: "goblins created" was the last
      // mechanical phrase left standing over the 71 calibration decks.
      return s.none ? "Token creation" : `${s.S} tokens`;
    case "creates":
      return s.none ? "Token makers" : `${s.S} token makers`;
    case "graveyard-recursion":
      return s.none ? "Recursion" : s.tribe ? `${s.S} reanimation` : `${s.S} recursion`;
    case "ramp-target":
      return s.none ? "Ramp" : `${s.S} ramp`;
    case "static":
      return null;
    default:
      return null;
  }
}

/** How `tagName` reached a name: a table entry, a family rule, a verb row (`verb-default` when the row has
 *  no typed form and the name is built from the bare one), or `fallback` (a family nobody has named, or a
 *  static kind with no entry). The completeness test asserts no vocabulary key reaches `fallback`. */
export type NameSource = "table" | "rule" | "verb" | "verb-default" | "fallback";

/** The name a player reads for a tag, anywhere in the report. See the header above. */
export function tagName(tag: Tag): string {
  return resolveTag(tag).name;
}

/** `tagName`, and which step produced it. */
export function tagNameSource(tag: Tag): NameSource {
  return resolveTag(tag).how;
}

/** The verb rows, exported so the test can walk every one of them. */
export const TAG_VERB_ROWS: readonly string[] = Object.keys(VERBS);

function resolveTag(tag: Tag): { name: string; how: NameSource } {
  // #543 (owner 2026-09-27): instants and sorceries are one group. The matcher folds its keys upstream; this
  // is only for the flat engine's `cast:instant` / `cast:sorcery` (patterns.ts), which the CLI names through here.
  const folded = tag.replace(/:(?:instant|sorcery)$/, ":instant-sorcery");
  const exact = THEME_NAMES[folded];
  if (exact !== undefined) return { name: exact, how: "table" };
  const i = folded.indexOf(":");
  const kind = i < 0 ? folded : folded.slice(0, i);
  const sub = i < 0 ? "" : folded.slice(i + 1);
  if (kind === "static") {
    // Every `EFFECT_KINDS` member is in the table; a kind added later still reads as words, and the
    // completeness test fails until it is named.
    return { name: `${capital(sub.replace(/-/g, " "))} effects`, how: "fallback" };
  }
  const s = subjectOf(sub);
  const ruled = familyRule(kind, sub, s);
  if (ruled !== null) return { name: ruled, how: "rule" };
  const verb = VERBS[kind];
  if (verb !== undefined) {
    const [bare, typed] = verb;
    if (s.none) return { name: bare, how: "verb" };
    return typed !== undefined ? { name: fill(typed, s), how: "verb" } : { name: `${s.S} ${lower(bare)}`, how: "verb-default" };
  }
  // A family nobody has named: its own words, never its slug. `tag` is `<family>:<subject>`.
  const words = capital(kind.replace(/-/g, " "));
  return { name: s.none ? words : `${s.S} ${lower(words)}`, how: "fallback" };
}
