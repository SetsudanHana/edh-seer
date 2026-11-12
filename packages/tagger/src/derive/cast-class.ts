import type { SubjectFilter } from "../schema.js";

/** THE CLASS OF A CARD AN EFFECT LETS A PLAYER CAST, READ OFF THE PRINTED CLAUSE (#1608 item 1).
 *
 *  A `cast` emit that names no class meets no typed cast payoff ("whenever you cast a noncreature spell", "an instant or sorcery spell", "a creature spell"): 107 stored rows carried one at DERIVE 501 (Gonti, Lord of Luxury;
 *  Thief of Sanity; Ragavan, Nimble Pilferer; Planeswalker's Mischief; every discover). The stored action's object is a back-reference ("that card", "it", "the copies") and the action walk that resolves it lands on the
 *  wrong thing as often as not (Gonti: "the rest on the bottom of that library"; Daxos: "you"; Ice Cauldron: "charge"), so the class is read off the words:
 *   - a class the permission is gated on ("If it's a Goblin creature card, you may cast that card"; "If it's an instant or sorcery card, exile it. You may cast it"; "... if it's an instant spell with mana value 2 or less");
 *   - else the nearest card the clause names before or in the permission ("exile target instant or sorcery card from a graveyard ... You may cast the copies": instant or sorcery; "the top card of that player's
 *     library", "a card in your hand", "a nonland card": no class, so any `spell`. A land is never cast, so "nonland" adds nothing);
 *   - else, for a pile the card fills in another ability ("a card exiled with Krang & Shredder"), the class every such ability names.
 *  `undefined` is "not read": the emit stays unclassed and silent, which is right where the words leave the class open.
 *  CEILING: unread, and still unclassed, are (a) a clause with no permission to cast at all, a condition the store filed as a cast ("if {C} was spent to cast it", Drowner of Truth; "if you cast it", Iridescent Tiger);
 *  (b) a class that depends on another card ("a card that shares a card type with it", Possibility Storm, Unpredictable Cyclone, Swindler's Scheme; "of the other type", Gale, Waterdeep Prodigy; "the card with the noted /
 *  chosen name", Magar of the Magic Strings, Garth One-Eye); (c) a back-reference whose card no words of this clause name (a delayed trigger: Power Pack; "Copy those exiled cards", Baron Helmut Zemo; "the exiled card",
 *  Gale's Redirection; "each exiled card you own with a kick counter on it", Zethi; "this card", Alaundo the Seer, Uvilda; "your commander", Geode Golem); (d) a pile whose filling ability names no card ("exile it instead
 *  of putting it into a graveyard", River Song's Diary) and (e) a "permanent card" (no cast row of the census names one). */
export type CastClass = Pick<SubjectFilter, "type" | "notType" | "subtype" | "colors" | "stats" | "legendary" | "colorCount">;

const PERMISSION = /\b(?:may|can) (?:look at and )?(?:cast|play)\b|\b(?:player|opponent|they) casts (?:it|them|that card|those cards)\b|\bcast the cop(?:y|ies)\b/i;
const CLASS_DEPENDS = /\bshares? a card type\b|\bof the other type\b|\bwith the (?:noted|chosen) name\b/i;
const GATE_BEFORE = /\bif (?:it's|it is|that card is) (an? (?:[a-z-]+,? )*?(?:(?:and\/or|or) [a-z-]+ )?)card, (?:exile it\. )?you may (?:cast|play)\b/i;
const GATE_AFTER = /\bif (?:it's|it is|that card is|that spell is) (an? (?:[a-z-]+,? )*?(?:(?:and\/or|or) [a-z-]+ )?)spell\b( with mana value \d+ or (?:less|greater))?/i;
/** A GATE THAT IS NOT A CARD TYPE (#1608 review). The colour ("If it's red, you may cast it", Chandra, Dressed to Kill) and the mana-value bound ("with mana value 3 or less", "if that spell's mana value is 4 or less")
 *  the words print are part of the class and ride the emit as `colors` and `stats`; "nonlegendary" and "monocolored" ride as the subject grammar reads them (`legendary: false`, `colorCount: mono`).
 *  CEILING: a gate no field holds leaves the cast UNREAD (unclassed and silent, as at DERIVE 501): an odd or even mana value (Yennett, Cryptic Sovereign). A bound that is a relation to another object stays out of
 *  the class and the cast stays classed: "a spell with lesser mana value" (Rashmi, Eternities Crafter), "less than the number of artifacts you control" (Rashmi and Ragavan), "the two spells have the same mana value"
 *  (Powerbalance), "a card of that color" (Sanar), "total mana value 5 or greater" over a pile (Dream Harvest). */
const COLOUR_GATE = /\bif (?:it's|it is|that card is) (white|blue|black|red|green), you may (?:cast|play)\b/i;
const MV_TAIL = /^ with mana value \d+ or (?:less|greater)\b/i;
const MV_GATE = /\bmana value is (\d+) or (less|greater)\b/i;
const UNHOLDABLE_GATE = /\bmana value is (?:odd|even)\b|\b(?:an )?(?:odd|even) mana value\b/i;
const CLASS_WORD = /^(?:non-?)?(?:instant|sorcery|creature|artifact|enchantment|planeswalker|battle|land|permanent|legendary|token|basic|historic|monocolored|multicolored|colorless|white|blue|black|red|green|kindred)$/i;
const CONNECTOR = /^(?:or|and|and\/or)$/i;
const NUMBER_WORD = /^(?:x|one|two|three|four|five|six|seven|eight|nine|ten|\d+)$/i;
const BACK_REFERENCE = /^(?:that|those|this|the|other|exiled|revealed|discarded|chosen|searched|remaining|milled)$/i;
const SOMEONES_HAND = /\b(?:opponent's|player's|their|your) hand\b/i;
const PILE = /\bexiled with\b/i;

function toClass(s: SubjectFilter): CastClass | undefined {
  const types = [s.type ?? []].flat().filter((t) => t !== "card" && t !== "spell" && t !== "land");
  if (types.includes("permanent")) return undefined;
  const notTypes = [s.notType ?? []].flat().filter((t) => t !== "land");
  const subtypes = [s.subtype ?? []].flat();
  const one = <T>(xs: T[]): T | T[] => (xs.length === 1 ? xs[0]! : xs);
  return {
    type: types.length === 0 ? "spell" : (one(types) as CastClass["type"]),
    ...(notTypes.length > 0 ? { notType: notTypes } : {}),
    // CEILING: a subtype beside a LIST of types ("instant, sorcery, and/or Tamiyo planeswalker cards", The Tale of Tamiyo) belongs to one member of it, and no field ties a subtype to one type of a list: the list alone
    // is kept, so the cast reads as any planeswalker's and meets a planeswalker-spell payoff no Tamiyo deck needs (Interplanar Beacon).
    ...(subtypes.length > 0 && types.length === 1 ? { subtype: one(subtypes) as CastClass["subtype"] } : {}),
    ...(s.colors !== undefined ? { colors: s.colors } : {}),
    ...(s.stats !== undefined ? { stats: s.stats } : {}),
    ...(s.legendary === false ? { legendary: false } : {}),
    ...(s.colorCount !== undefined ? { colorCount: s.colorCount } : {}),
  };
}

/** The nearest card phrase of `region` that names a card of its own, as "<class words>|<mana-value tail>": the class words ("instant or sorcery", "nonlegendary", "Goblin creature"; none for a card of no class) and the
 *  bound printed straight after the card (" with mana value 4 or less"). Undefined when the region names no card. */
function nearestCard(region: string, permissionAt = 0): string | undefined {
  const cards = [...region.matchAll(/\bcards?\b(?!'s| types?\b| names?\b)/gi)];
  for (let i = cards.length - 1; i >= 0; i--) {
    const at = cards[i]!.index;
    if (PILE.test(region.slice(at, at + 20))) continue;
    // A card a TRIGGER watches being cast is no take: "Whenever a player casts a card, if it has the same name as one of the cards exiled with this artifact" (Spellweaver Helix). The permission's own object is one.
    if (at < permissionAt && /\bcasts? (?:an? |the )?$/i.test(region.slice(0, at))) continue;
    const sentenceStart = Math.max(region.lastIndexOf(". ", at) + 2, 0);
    const lead = region.slice(sentenceStart, at);
    // The subject of a count condition is no take: "If two or more cards are exiled this way, choose one of them" (Mysterious Stranger).
    if (/^if\b/i.test(lead) && !lead.includes(",")) continue;
    const words = lead.split(" ").filter(Boolean);
    const cls: string[] = [];
    let boundary = "";
    for (let w = words.length - 1; w >= 0; w--) {
      const raw = words[w]!, word = raw.replace(/,$/, "");
      if (NUMBER_WORD.test(word)) continue;
      const subtype = /^[A-Z][a-z]+$/.test(word) && cls.length > 0 && w > 0;
      if (CLASS_WORD.test(word) || subtype || (CONNECTOR.test(word) && cls.length > 0 && w > 0 && CLASS_WORD.test(words[w - 1]!.replace(/,$/, "")))) { cls.unshift(raw); continue; }
      boundary = word;
      break;
    }
    if (BACK_REFERENCE.test(boundary) && !(boundary.toLowerCase() === "the" && cls.length > 0)) continue;
    // "If it's a land card, ... Otherwise, you may cast it": the condition's class is not the card taken.
    if (/\bif (?:it's|it is|that card is) an?$/i.test(words.slice(0, words.length - cls.length).join(" "))) continue;
    // A land is never cast: "nonland" narrows nothing. The mana-value bound printed straight after the card ("cards with mana value 4 or less") is kept with it; a TOTAL over a pile is not one card's bound.
    const tail = MV_TAIL.exec(region.slice(at + cards[i]![0].length))?.[0] ?? "";
    return `${cls.filter((w) => !/^non-?land,?$/i.test(w)).join(" ").replace(/^(?:or|and|and\/or) /i, "")}|${tail}`;
  }
  return undefined;
}

export function castClassFromPrint(clauseText: string, pileTexts: readonly string[], parse: (text: string) => SubjectFilter): CastClass | undefined {
  const m = PERMISSION.exec(clauseText);
  if (!m) return undefined;
  const end = clauseText.indexOf(".", m.index);
  const region = clauseText.slice(0, end < 0 ? undefined : end);
  if (CLASS_DEPENDS.test(region) || UNHOLDABLE_GATE.test(region)) return undefined;
  // The gates the permission's own words add to whatever card is taken: a colour, a mana-value bound.
  const colour = COLOUR_GATE.exec(region)?.[1]?.toLowerCase();
  const bound = MV_GATE.exec(region.slice(m.index));
  const boundTail = bound ? ` with mana value ${bound[1]} or ${bound[2]!.toLowerCase()}` : "";
  const read = (near: string): CastClass | undefined => {
    const [words = "", tail = ""] = near.split("|");
    const phrase = [colour, words].filter(Boolean).join(" ");
    return toClass(parse(`a ${phrase} card${tail || boundTail}`.replace(/\s+/g, " ")));
  };
  const gate = GATE_BEFORE.exec(region) ?? GATE_AFTER.exec(region.slice(m.index));
  if (gate) {
    const words = gate[1]!.replace(/^an? /i, "").replace(/\bnon-?land,? ?/gi, "").trim();
    if (words !== "" || gate[2]) return read(`${words}|${gate[2] ?? ""}`);
  }
  const near = nearestCard(region, m.index);
  if (near !== undefined) return read(near);
  if (PILE.test(region)) {
    const fills = pileTexts.map((t) => { const c = nearestCard(t); return c === undefined ? undefined : read(c); });
    if (fills.length > 0 && fills.every((c) => c !== undefined && JSON.stringify(c) === JSON.stringify(fills[0]))) return fills[0];
    return undefined;
  }
  return SOMEONES_HAND.test(region.slice(0, m.index)) ? read("|") : undefined;
}

/** THE CARD CAST IS CERTAINLY YOURS (#1608): the words up to the permission take it from YOUR library, hand or graveyard and name no other zone ("Exile the top card of your library. You may cast that card", Chandra, Torch
 *  of Defiance). The emit then says `owner: you`, which "whenever you cast a spell you don't own" (Nita, Forum Conciliator; Vaan, Street Thief) refuses. Typed `spell` with no owner it would have met them.
 *  CEILING: only a zone the words call yours. "Draw a card, then discard a card ... cast the discarded card" (Malcolm), a pile another ability fills (Quintorius, Loremaster) and a card every player's zone can
 *  supply ("a graveyard", "each player mills") write no owner, and still meet those payoffs. */
export function castsYourOwnCard(clauseText: string, casterIsAnyPlayer = false): boolean {
  const m = PERMISSION.exec(clauseText);
  if (!m) return false;
  const end = clauseText.indexOf(".", m.index);
  const region = clauseText.slice(0, end < 0 ? undefined : end);
  // ANOTHER PLAYER WHO CASTS OFF "THEIR" LIBRARY OR HAND CASTS THEIR OWN CARD: "that player exiles the top card of their library ... the player casts it" (Omen Machine), "reveals a card at random from their hand"
  // (Wild Evocation). The owner is the caster's, which is what `owner: you` says beside `control: any`.
  if (casterIsAnyPlayer) return /\btheir (?:library|hand|graveyard)\b/i.test(region) && !/\b(?:your|opponent's|opponents'|player's|players'|a|an|each|that|single) (?:library|hand|graveyard)s?\b/i.test(region);
  return /\byour (?:library|hand|graveyard)\b/i.test(region) && !/\b(?:opponent's|opponents'|player's|players'|their|a|an|each|that|single) (?:library|hand|graveyard)s?\b/i.test(region);
}
