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
 *  sorceries are one group: `cast:instant` and `cast:sorcery` are named as `cast:instant-sorcery`.
 *  That is a fold of the NAME only; the reason tags still carry the two types (PR 3 moves it to the key).
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
  "fodder:creature": "Sac fodder",
  "graveyard-recursion:creature": "Reanimator",
  "graveyard-recursion:any": "Recursion",
  "graveyard-intercept:any": "Playing their exiled cards",
  "doubles:enters": "ETB doublers",
  "copies:triggered": "Trigger copiers",
  "copies:activated": "Ability copiers",
  "creates:treasure": "Treasure makers",
  "creates:emblem": "Emblems",
  "scales:creature": "Go wide",
  "scales:land": "Lands matter",
  "scales:party": "Party",
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

/** Subjects of `enters:` and `scales:` that are NOT creature types, so the tribal rule must not
 *  claim them. Every one of these is a card type, a supertype, a non-creature subtype or a class the
 *  engine counts (a party, what you donated) -- this list exists so a subject the table has never
 *  seen falls to the tribal rule only when it really is a tribe. */
const NOT_A_TRIBE = new Set([
  "creature", "artifact", "enchantment", "land", "planeswalker", "instant", "sorcery", "battle",
  "legendary", "token", "permanent", "aura", "equipment", "vehicle", "saga", "curse", "any",
  "spell", "instant-sorcery", "basic", "historic", "card", "party", "donated", "nontoken", "__none__",
]);

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

function subjectOf(sub: string): Subj {
  const none = sub === "" || sub === "any";
  if (sub === "__none__") return { none: false, tribe: false, S: "Unchosen type", p: "unchosen types", P: "Unchosen types" };
  const S = sub === "instant-sorcery" ? "Instant and sorcery" : sub.startsWith("-") ? `Non${sub.slice(1)}` : titleCase(sub);
  const p = pluralSubject(sub);
  return { none, tribe: !none && !NOT_A_TRIBE.has(sub) && !sub.startsWith("-") && /^[a-z]+([ -][a-z]+)*$/.test(sub), S, p, P: capital(p) };
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
  upkeep: ["Upkeep triggers"],
  "begin-combat": ["Beginning-of-combat triggers"],
  "end-step": ["End-step triggers"],
  "dice-rolled": ["Dice rolling"],
  scry: ["Scry"],
  surveil: ["Surveil"],
  search: ["Library searching", "Searching for {p}"],
  "counter-spell": ["Counterspells", "{S} counterspells"],
  "loses-game": ["Losing the game"],
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
  goad: ["Goad"], exert: ["Exert"], detain: ["Detain"], suspect: ["Suspect"], harness: ["Harness"],
  vote: ["Voting"], clash: ["Clash"], fateseal: ["Fateseal"], behold: ["Behold"], heal: ["Healing"],
  convert: ["Convert"], explore: ["Explore"], endure: ["Endure"], learn: ["Learn"], forage: ["Forage"],
  "time-travel": ["Time travel"], "collect-evidence": ["Collecting evidence"],
  "venture-into-the-dungeon": ["Venturing into the dungeon"],
  "face-a-villainous-choice": ["Facing a villainous choice"],
  "face-a-dilemma": ["Facing a dilemma"],
  airbend: ["Airbend"], waterbend: ["Waterbend"], foretell: ["Foretell"],
  "flip-coin": ["Coin flips"], monarch: ["Monarch"], initiative: ["Initiative"],
  "city-blessing": ["City's blessing"], "ring-tempts": ["The Ring tempting you"], prepared: ["Prepared"],
  proliferate: ["Proliferate"],
  // The pass literals `edges.ts` writes itself (the reason tag's family is not a trigger verb).
  "recursion-target": ["Recursion targets", "{S} recursion targets"],
  tutor: ["Tutors", "{S} tutors"],
  fodder: ["Sacrifice fodder", "{S} fodder"],
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
  "graveyard-intercept": ["Playing their exiled cards"],
  "non-combat-damage": ["Burn", "{S} non-combat damage"],
  "etb-refire": ["Blink"],
  meld: ["Melding cards"],
  tribe: ["Tribes", "{P}"],
  "tribe-nontoken": ["Nontoken tribes", "Nontoken {P}"],
  counter: ["Counters", "{S} counters"],
  token: ["Tokens", "{S} tokens"],
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

/** The name a player reads for a tag, anywhere in the report. See the header above. */
export function tagName(tag: Tag): string {
  // #543 (owner 2026-09-27): instants and sorceries are one group on the page. The name folds; the key does not.
  const folded = tag.replace(/:(?:instant|sorcery)$/, ":instant-sorcery");
  const exact = THEME_NAMES[folded];
  if (exact !== undefined) return exact;
  const i = folded.indexOf(":");
  const kind = i < 0 ? folded : folded.slice(0, i);
  const sub = i < 0 ? "" : folded.slice(i + 1);
  if (kind === "static") {
    // The kind is the whole content of a static tag; the kinds the owner named are in the table.
    return `${capital(sub.replace(/-/g, " "))} effects`;
  }
  const s = subjectOf(sub);
  const ruled = familyRule(kind, sub, s);
  if (ruled !== null) return ruled;
  const verb = VERBS[kind];
  if (verb !== undefined) {
    const [bare, typed] = verb;
    if (s.none) return bare;
    return typed !== undefined ? fill(typed, s) : `${s.S} ${lower(bare)}`;
  }
  // A family nobody has named: its own words, never its slug. `tag` is `<family>:<subject>`.
  const words = capital(kind.replace(/-/g, " "));
  return s.none ? words : `${s.S} ${lower(words)}`;
}
