import type { Card } from "./card.js";
import { PATTERNS } from "./patterns.js";
import { toCardView, type CardView } from "./cardview.js";

export type Tag = string;

export function tag(family: string, value?: string): Tag {
  return value === undefined ? family : `${family}:${value}`;
}

const BARE_LABELS: Record<string, string> = {
  "creature-etb": "creatures entering",
  "nontoken-etb": "a nontoken creature entering",
  "creature-death": "creatures dying",
  "sacrifice-fodder": "sacrifice fodder",
  "sacrifice-event": "sacrifice",
  "land-etb": "lands entering",
  "card-draw": "card draw",
  "graveyard": "the graveyard",
  "lifegain": "life gain",
  "blink": "blink/flicker",
  "enchantment": "enchantments",
  "aura": "auras",
  "equipment": "equipment",
  "attack-trigger": "attack triggers",
  // roadmap G1: a deck whose entry triggers are worth re-firing, and which carries the flicker,
  // copy and trigger-doubling effects that do it.
  "etb-refire": "re-firing entry triggers",
};

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

/** The mechanism half of a tag: everything before the first ":". Tags are `<verb>:<subject>`.
 *  For most verbs the segment after the colon is a KIND axis (`tribe:wizard` vs `tribe:goblin`,
 *  `static:pump` vs `static:cost-reduction`) — different subjects there are different themes and
 *  must never be summed together. `:any` is the one subject value that is a GRANULARITY, not a
 *  kind: it names the general form of the same mechanism, so `counter-added:any` subsumes
 *  `counter-added:creature` rather than a different counter theme. Use this to ask "same
 *  mechanism?" (as describeTag does below); it is not a safe grouping key for summing deck
 *  frequency across subjects — see rankThemes in weights.ts, which only folds the literal
 *  `:any` sibling, not the whole family. */
export function tagFamily(tag: Tag): string {
  const i = tag.indexOf(":");
  return i === -1 ? tag : tag.slice(0, i);
}

/** How each STRUCTURED verb family reads once its subject is named. `BARE_LABELS` above is the FLAT
 *  engine's vocabulary — `creature-etb`, `sacrifice-fodder` — and structured tags (`enters:wizard`,
 *  `dies:creature`) carry their subject after the colon instead, so without this map they fell to
 *  the default branch and rendered as the bare verb. Measured before this existed: not one of five
 *  tribal calibration decks named its tribe (wick-changelings themed "enters / create token",
 *  draguns "draw / enters"), and marchesa-legends-matter read "dies / enters".
 *
 *  The phrasing deliberately matches the flat labels these sit beside: `creature-etb` has always
 *  rendered "creatures entering", so `enters:creature` renders the same words.
 *
 *  A family ABSENT from this map keeps the bare form, which is the conservative default and is
 *  correct for `static:` — `edges.ts` writes `static:${effect.kind}`, so its value is a KIND, not a
 *  subject, and "pumps static" would be a wrong sentence. */
const MECHANISM_PHRASE: Record<string, string> = {
  enters: "entering",
  dies: "dying",
  leaves: "leaving",
  attacks: "attacking",
  blocks: "blocking",
  taps: "tapping",
  untaps: "untapping",
  sacrifice: "sacrificed",
  sacrificed: "sacrificed",
  discard: "discarded",
  discarded: "discarded",
  mill: "milled",
  milled: "milled",
  "counter-added": "getting counters",
  "create-token": "created",
};

/** A subject value as a plural noun phrase. `themeSubjectKey` writes a NEGATION as `-creature`,
 *  which reached the user verbatim as "-creatures" on kuja-spellslinger; it reads as a word here.
 *  Returns null for `any`, which names no subject at all — the mechanism alone is the whole claim,
 *  and "anys entering" is worse than silence. */
/** Subjects whose plural is not "+s". `legendary` is a SUPERTYPE, not a noun, and it became a
 *  headline when it got a theme key (roadmap A11) — "legendarys entering" is not English. The rest
 *  are creature types whose plural is the same word; they read as headlines too, and this list is
 *  the whole fix rather than a pluralizer nobody asked for. */
const IRREGULAR_PLURAL: Record<string, string> = {
  legendary: "legendary permanents",
  merfolk: "Merfolk",
  kithkin: "Kithkin",
  eldrazi: "Eldrazi",
  samurai: "Samurai",
  ninja: "Ninja",
  spirit: "Spirits",
};

function subjectPhrase(value: string): string | null {
  if (value === "any") return null;
  const irregular = IRREGULAR_PLURAL[value];
  if (irregular !== undefined) return irregular;
  const negated = value.startsWith("-");
  const noun = negated ? `non${value.slice(1)}` : value;
  return noun.endsWith("s") ? noun : `${noun}s`;
}

export function describeTag(t: Tag): string {
  const family = tagFamily(t);
  const value = family === t ? undefined : t.slice(family.length + 1);
  const bare = (): string => BARE_LABELS[family] ?? family.replace(/-/g, " ");
  switch (family) {
    case "tribe":
      return `${capitalize(value ?? "")}s`;
    case "tribe-nontoken":
      return `nontoken ${capitalize(value ?? "")}s`;
    case "counter":
      return `${value} counters`;
    case "cast":
      // A negated cast subject names the SPELL, not the excluded type: Valley Floodcaller's
      // "noncreature spell" is a spell you cast, so "noncreatures" would drop the noun.
      if (value?.startsWith("-")) return `non${value.slice(1)} spells`;
      return `${value}s`;
    case "token":
      return value ? `${value} tokens` : "tokens";
    // A STATIC NAMES ITS KIND OR IT NAMES NOTHING. The default branch below has no
    // `MECHANISM_PHRASE` entry for `static`, so it fell through to the bare family name and every
    // static theme rendered as the word "static" -- `everything-is-a-land`, a CLONE deck, headlined
    // "static" on `static:clone`. The kind is the whole content of the tag.
    case "static":
      return value ? `${value.replace(/-/g, " ")} effects` : "static effects";
    default: {
      const phrase = MECHANISM_PHRASE[family];
      if (value === undefined || phrase === undefined) return bare();
      const subject = subjectPhrase(value);
      return subject === null ? bare() : `${subject} ${phrase}`;
    }
  }
}

function resolveTags(
  spec: Tag[] | ((view: CardView) => Tag[]) | undefined,
  view: CardView,
): Tag[] {
  if (!spec) return [];
  return typeof spec === "function" ? spec(view) : spec;
}

export function extractTags(card: Card): { produces: Set<Tag>; cares: Set<Tag> } {
  const view = toCardView(card);
  const produces = new Set<Tag>();
  const cares = new Set<Tag>();
  for (const p of PATTERNS) {
    if (p.matches(view)) {
      for (const t of resolveTags(p.produces, view)) produces.add(t);
      for (const t of resolveTags(p.cares, view)) cares.add(t);
    }
  }
  return { produces, cares };
}
