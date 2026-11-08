import type { Ability, ChosenKind } from "../schema.js";
import { withoutParentheses } from "./reminder.js";
import { CREATURE_SUBTYPES, LAND_SUBTYPES } from "./subtypes.js";

/** WHAT WAS CHOSEN, for every `chosenType` subject (#1568). `chosenType` says "narrowed by a choice made as the permanent entered"; it never said WHICH choice, and the matcher resolves it to the deck's most common CREATURE subtype
 *  whatever it was: Cloud Key ("choose artifact, creature, enchantment, instant, or sorcery"), Extinction Event ("odd or even"), Shimmer ("a land type") and Leori ("a planeswalker type") became a creature type of the deck. `chosenKind`
 *  is the additive answer, stamped beside `chosenType` (which keeps every reader of it as it was), read off the printed words the way `chosenColorOf` reads a colour.
 *
 *  The kinds: `creature-type` ("choose a creature type", "the creature type of your choice", a list of creature types: Dawn-Blessed Pennant), `card-type` ("choose a card type", "a permanent type", "artifact, creature, or land"),
 *  `land-type`, `planeswalker-type`, `parity` ("odd or even", "the chosen quality").
 *
 *  The ability's own clause decides, and the card's text when the clause holds no choice of its own (the usual shape: "As this enters, choose a creature type" is one clause and "creatures of the chosen type" another). A text that makes two
 *  different choices decides nothing, and so does one that makes none: the subject is left without a kind, which the matcher reads as unknown and answers by the old text cue.
 *  CEILING: only the kind of the choice is stamped. WHO chooses ("an opponent chooses a creature type": Callous Oppressor) and whether the subject is the choice or its NEGATION ("creatures that aren't of the chosen type": Kindred Dominance) are not carried; the
 *  matcher still reads those two off the printed words. */
const CREATURE = new Set(CREATURE_SUBTYPES.filter((s) => !LAND_SUBTYPES.has(s)));
const BASIC_LAND = new Set(["plains", "island", "swamp", "mountain", "forest"]);
const CARD_TYPES = new Set(["artifact", "creature", "enchantment", "instant", "sorcery", "land", "planeswalker", "battle", "kindred", "tribal", "non-aura enchantment", "nonland permanent", "permanent", "noncreature", "nonland"]);
const COLOURS = new Set(["white", "blue", "black", "red", "green"]);

/** The kinds of every choice a text makes, "choose X" in the reminder-free words. */
function kindsIn(text: string): Set<ChosenKind> {
  const t = withoutParentheses(text);
  const out = new Set<ChosenKind>();
  if (/\bchooses? odd or even\b/i.test(t) || /\bchosen quality\b/i.test(t)) out.add("parity");
  if (/\bchooses? (?:an? )?(?:colou?r and (?:an? )?)?creature type\b|\bcreature type of your choice\b|\bchosen creature type\b|\bcreature type you chose\b/i.test(t)) out.add("creature-type");
  if (/\bchooses? (?:an? )?(?:basic )?land type\b|\bland type of your choice\b/i.test(t)) out.add("land-type");
  if (/\bchooses? (?:an? )?planeswalker type\b/i.test(t)) out.add("planeswalker-type");
  if (/\bchooses? (?:an? )?(?:card|permanent|nonland permanent|spell) type\b|\bcard type of your choice\b/i.test(t)) out.add("card-type");
  // "choose artifact, creature, or land", "choose Island or Swamp", "choose white Citizen, blue Camarid, ...": a choice from a printed LIST, read by what its members are.
  for (const m of t.matchAll(/\bchooses? ([^.:\n]{3,200}?)(?:\.|\n|$|:)/gi)) {
    // a list ends where its sentence's own words resume: "chooses artifact, creature, or land during their untap step" (Storage Matrix)
    const body = m[1]!.split(/\s(?:during|at|as|when|then)\s/i)[0]!;
    if (!/,| or /.test(body)) continue;
    const items = body.split(",").flatMap((part) => part.split(" or ")).map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (items.length < 2 || items.length > 12) continue;
    const bare = items.map((x) => { const w = x.split(" "); return w.length > 1 && COLOURS.has(w[0]!) ? w.slice(1).join(" ") : x; });
    if (bare.every((x) => CARD_TYPES.has(x))) out.add("card-type");
    else if (bare.every((x) => BASIC_LAND.has(x))) out.add("land-type");
    else if (bare.every((x) => CREATURE.has(x))) out.add("creature-type");
  }
  return out;
}

/** The kind of the one choice this text makes; undefined when it makes none, or more than one kind. */
export function chosenKindOfText(text: string): ChosenKind | undefined {
  const kinds = kindsIn(text);
  return kinds.size === 1 ? [...kinds][0] : undefined;
}

const stamp = (v: unknown, kind: ChosenKind): unknown => {
  if (Array.isArray(v)) return v.map((x) => stamp(x, kind));
  if (v === null || typeof v !== "object") return v;
  const o = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(o)) out[k] = stamp(x, kind);
  if (o.chosenType === true && out.chosenKind === undefined) out.chosenKind = kind;
  return out;
};

export function chosenKindOf(abilities: Ability[], clauseTexts: Record<number, string> | undefined, cardText: string): Ability[] {
  const whole = chosenKindOfText(cardText);
  return abilities.map((a) => {
    if (!JSON.stringify(a).includes('"chosenType":true')) return a;
    const own = a.clause === undefined ? undefined : clauseTexts?.[Math.trunc(Number(a.clause))];
    const kinds = own === undefined ? new Set<ChosenKind>() : kindsIn(own);
    // A clause that makes two choices is not told apart; one that makes none falls to the whole card.
    const kind = kinds.size > 1 ? undefined : kinds.size === 1 ? [...kinds][0] : whole;
    return kind === undefined ? a : stamp(a, kind) as Ability;
  });
}
