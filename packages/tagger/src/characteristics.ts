import type { Card } from "@edh-seer/engine";
import type { Characteristics } from "./schema.js";
import { CREATURE_SUBTYPES, joinMultiWordSubtypes } from "./derive/subtypes.js";
import { parseSubject } from "./derive/subject.js";

/** Scryfall type lines use an em dash (U+2014) between types and subtypes. */
const TYPE_SUBTYPE_SEP = " — ";
/** The corpus joins a multi-face card's faces into one line: "Creature — Dog Warlock // Instant". */
const FACE_SEP = " // ";

/** Layouts where only the FRONT face is ever cast or played. The back is reached by transforming
 *  or flipping a permanent already on the battlefield, which is not a zone change: no card enters,
 *  and no spell is cast. This must stay a short ALLOW-list rather than a reject one — everything
 *  else that carries two faces really is playable from either side (a modal DFC, an adventure, a
 *  split card, a `prepare` card's copied spell), and a reject-list would silently narrow whatever
 *  layout gets printed next. */
const FRONT_FACE_ONLY = new Set(["transform", "flip"]);
/** CR 702.162 (More Than Meets the Eye): "You may cast this card converted" -- the back face is cast
 *  from hand like a modal DFC's, on a card Scryfall files under `transform`. Fifteen corpus cards,
 *  all Transformers. Read off the printed keyword rather than the layout, because the layout is the
 *  one thing that does not say it: Starscream cast converted is a Vehicle entering, which Tails'
 *  "whenever a Vehicle you control enters" watches (recall v4 #151, 2026-09-09). */
const CAST_EITHER_FACE = "more than meets the eye";

/** THE ONE FACE RULE (#1268 F7): is only this card's FRONT face ever cast or played? True for a transform or flip
 *  card, except one that says More Than Meets the Eye. `playableFaces` is built on it, and the matcher's mana lines
 *  and goldfish type line read it too rather than keep their own copy of the layout set. */
export function frontFaceOnly(layout: string | undefined, keywords: readonly string[] = []): boolean {
  return layout !== undefined && FRONT_FACE_ONLY.has(layout)
    && !keywords.some((k) => k.toLowerCase() === CAST_EITHER_FACE);
}

/** The faces this card can actually be PLAYED as, one at a time — each with its own types and
 *  subtypes, never merged. `undefined` for a single-face card, where the card is its one face and
 *  the union already says everything.
 *
 *  Merging is what the union does, and it is right for what a permanent can BE on the battlefield
 *  and wrong for what enters or is cast. Read as one subject, "Instant // Land" is a land that gets
 *  cast and an instant that enters the battlefield — neither of which happens. Per face it is a
 *  land that enters OR an instant that is cast, which is exactly the card. */
export function playableFaces(typeLine: string, layout?: string, keywords: readonly string[] = []): Characteristics["faces"] {
  const parts = typeLine.split(FACE_SEP);
  if (parts.length < 2) return undefined;
  const playable = frontFaceOnly(layout, keywords) ? parts.slice(0, 1) : parts;
  return playable.map((face) => {
    const [types, subtypes] = splitTypeLine(face);
    return { types, subtypes };
  });
}

/** "X IS ALSO A CLERIC, ROGUE, WARRIOR, AND WIZARD" IS THE CARD'S OWN TYPE LINE, printed in the
 *  text box. Four corpus cards say it (Burakos, Party Leader; Stonework Packbeast; Tajuru Paragon;
 *  Veteran Adventurer) and each derived only its printed subtypes, so no Rogue payoff saw Burakos
 *  and his own party count could not count him (owner, 2026-09-05). Only words the closed creature
 *  subtype list knows are admitted: the sentence is read, not trusted. */
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function alsoTypes(card: Card): string[] {
  // ANCHORED ON THE CARD'S OWN NAME, never a wildcard prefix: a lazy `[^\n.]{1,60}?` before the
  // verb is polynomial on a run of spaces (CodeQL js/polynomial-redos, PR #191). A legendary card
  // names itself by the part before the comma -- "Burakos is also ..." on Burakos, Party Leader.
  const name = card.name ?? "";
  const names = [...new Set([name, name.split(",")[0]!.trim(), "This creature"])].filter(Boolean);
  const re = new RegExp(`(?:^|\\n)(?:${names.map(escapeRe).join("|")}) is also an? ([^.\\n]{1,80})\\.`);
  const m = re.exec(card.oracleText ?? "");
  if (!m) return [];
  const known = new Set<string>(CREATURE_SUBTYPES);
  // "Cleric, Rogue, Warrior, and Wizard": commas first, then a plain " and " inside each piece, then
  // a leading "and " left by the Oxford comma. String splits, not one alternating regex -- CodeQL
  // flagged `,\s*(?:and\s+)?|\s+and\s+` as polynomial on a run of spaces (PR #191, twice).
  return m[1]!.split(",")
    .flatMap((piece) => piece.split(" and "))
    .map((w) => w.trim().toLowerCase().replace(/^and /, ""))
    .filter((w) => known.has(w));
}

/** "<THIS CARD> IS EVERY CREATURE TYPE" AS A LINE OF ITS OWN TEXT (a characteristic-defining ability, CR 604.3; the same effect as the Changeling keyword, CR 702.73a "This object is every creature type"). Anchored on the card's own name or "This creature", as `alsoTypes` is,
 *  with string tests rather than a wildcard prefix. A grant to other permanents ("Creatures you control are every creature type": Maskwood Nexus; "Equipped creature ... is every creature type": Runed Stalactite) names a different subject
 *  and is not this card's type line, and reminder text "(It's every creature type.)" never starts a line with a name. 2 corpus cards, 2026-11-24 (Mistform Ultimus, Dr. Julius Jumblemorph; the second prints the part of its name after "Dr. ").
 *  CEILING: a face of a multi-face card is matched by its own name, and the card is read as a whole (every face gets the types). */
const EVERY_TYPE_LINE = " is every creature type";
function isEveryType(card: Card): boolean {
  const name = card.name ?? "";
  const names = [name, ...name.split(" // "), "This creature", "This card"].filter(Boolean);
  for (const line of (card.oracleText ?? "").split("\n")) {
    const at = line.indexOf(EVERY_TYPE_LINE);
    if (at <= 0) continue;
    const subject = line.slice(0, at).trim();
    // The part of a legendary's name before the comma, or after a title ("Dr. Julius Jumblemorph" prints "Julius Jumblemorph").
    if (names.some((n) => n === subject || n.split(",")[0]!.trim() === subject || n.endsWith(` ${subject}`))) return true;
  }
  return false;
}

/** IS THIS CARD EVERY CREATURE TYPE (CR 702.73a)? The Changeling keyword, or the explicit subtype list `extractCharacteristics` gives a card whose own text says it (Mistform Ultimus, #1785). ONE predicate for the three places that treat an every-type card as
 *  a special case (what it advertises as a theme, whether it is a body for any one tribe, whether a chosen type includes it): its explicit subtypes still let it meet tribal triggers and lords, which is right, but never fan it out as a theme or a tribe's body. */
export function isEveryCreatureType(ch: { keywords?: readonly string[]; subtypes?: readonly string[] } | undefined): boolean {
  if (ch === undefined) return false;
  if ((ch.keywords ?? []).some((k) => k.toLowerCase() === "changeling")) return true;
  const have = ch.subtypes ?? [];
  if (have.length < CREATURE_SUBTYPES.length) return false;
  const set = new Set(have);
  return CREATURE_SUBTYPES.every((t) => set.has(t));
}

/** A CARD'S TEXT, ONE STRING PER FACE: the corpus joins a multi-face card's oracle text on a "//" line. */
const faceTexts = (oracleText: string): string[] => oracleText.split("\n//\n");

/** A LINE THAT GETS ROUND DEFENDER: "can attack as though it didn't have defender", "loses defender" (also "lose defender"). A line that only counts or names creatures with defender does not. */
const GETS_ROUND_DEFENDER = /(?:didn['\u2019]t|did not) have defender|loses? defender/;

/** DOES THIS FACE'S TEXT PRINT DEFENDER, AND NOTHING IN IT GETS ROUND IT (#1753; CR 702.3b)? A keyword line is a list split on commas or semicolons ("Defender", "Flying, defender", "Defender; reach"), reminder text removed.
 *  A face with another line that gets round defender ("can attack as though it didn't have defender", "loses defender": GETS_ROUND_DEFENDER) is not barred. A line that merely names the class ("a creature with defender") is ignored.
 *  CEILING: a card with such a line is never barred, whatever its condition (Mirror Wall's {W}, Bristlepack Sentry's power 4, Elder Land Wurm's block), so it still supplies `attacks`.
 *  CEILING: a creature handed "can attack as though it didn't have defender" by ANOTHER card (Arcades, High Alert, Felothar, Ghalta, Assault Formation, Rolling Stones, Warmonger's Chariot, Animate Wall) is read
 *  as barred by a PAIR (the matcher judges two cards and does not see the enabler); a DECK holding one clears it again, in `analyzeDeckStructured` (#1756, packages/matcher/src/defender-enablers.ts). */
function barredByDefender(text: string): boolean {
  let keyword = false;
  for (const raw of text.split("\n")) {
    const paren = raw.indexOf("(");
    const line = (paren < 0 ? raw : raw.slice(0, paren)).trim().toLowerCase();
    if (line.split(/[,;]/).map((w) => w.trim()).includes("defender")) keyword = true;
    else if (GETS_ROUND_DEFENDER.test(line)) return false;
  }
  return keyword;
}

export function extractCharacteristics(card: Card): Characteristics {
  const [left, right] = splitTypeLine(card.typeLine);
  const playable = playableFaces(card.typeLine, card.layout, card.keywords);
  // Defender is read off the printed keyword for a single face and off each face's own text for a multi-face card (`keywords` is the union of both faces).
  const texts = faceTexts(card.oracleText ?? "");
  const faces = playable?.map((f, i) => barredByDefender(texts[i] ?? "") && f.types.includes("creature") ? { ...f, defender: true as const } : f);
  const defender = playable === undefined && card.keywords.some((k) => k.toLowerCase() === "defender") && barredByDefender(card.oracleText ?? "");
  const keywords = card.keywords.map((k) => k.toLowerCase());
  // CHANGELING IS A CHARACTERISTIC-DEFINING ABILITY: the card has EVERY creature type, in every
  // zone — not only on the battlefield, which is why it belongs here and not in an implied event.
  // Scryfall prints the type line as "Creature — Shapeshifter", so without this a changeling matched
  // no typal payoff at all and CLAUDE.md's chosenType rubric ("every changeling is every creature
  // type, so any choice works and all typal edges are real") described behaviour the engine did not
  // have. Applies whatever the card's types: Crib Swap is a Kindred Instant and is still every
  // creature type wherever it sits. 66 corpus cards, 32 inside the normalized set.
  // A CARD THAT SAYS IT IS EVERY CREATURE TYPE WITHOUT THE KEYWORD has them all the same, in every zone (Mistform Ultimus, Dr. Julius Jumblemorph: "<name> is every creature type (even if this card isn't on the battlefield)", #1785): see `isEveryType`.
  const subtypes = keywords.includes("changeling") || isEveryType(card)
    ? [...new Set([...right, ...CREATURE_SUBTYPES])]
    : [...new Set([...right, ...alsoTypes(card)])];
  const enchants = right.includes("aura") ? enchantsOf(card.oracleText ?? "") : undefined;
  return {
    types: left,
    subtypes,
    ...(faces ? { faces } : {}),
    ...(defender && left.includes("creature") ? { defender: true as const } : {}),
    // Carried for the zone rules — see `zoneTypes`. Free: it is already on the card document.
    ...(card.layout ? { layout: card.layout } : {}),
    colors: card.colors,
    identity: card.colorIdentity ?? [],
    cmc: card.manaValue,
    power: card.power ?? null,
    toughness: card.toughness ?? null,
    token: false,
    keywords,
    ...(enchants ? { enchants } : {}),
    ...(card.oracleText === "" ? { noAbilities: true as const } : {}),
    ...(/\ba deck can have (?:any number of|up to \w+) cards named\b/i.test(card.oracleText) ? { anyNumber: true as const } : {}),
  };
}

/** The printed "Enchant ..." line (CR 702.5a), reminder text and the trailing period dropped. Only
 *  the FIRST such line: a two-face card with two Auras is a ceiling here, as it is for
 *  `boundedByEnchantLine` in derive.ts, which reads the same line per face. */
const ENCHANT_LINE = /^Enchant ([^\n(]+)/m;

/** WHAT AN AURA ATTACHES TO, as a subject -- see `Characteristics.enchants`. Refuses a line that
 *  names no class ("Enchant player"), so an Aura on a player never reads as one on a permanent, and
 *  a line that names a CARD in a zone ("Enchant creature card in a graveyard", Animate Dead): the
 *  parser drops the zone, and a card in a graveyard has no host that can die. */
function enchantsOf(oracleText: string): Characteristics["enchants"] {
  const raw = ENCHANT_LINE.exec(oracleText)?.[1]?.trim().replace(/\.$/, "");
  if (!raw || /\bcards?\b/i.test(raw)) return undefined;
  const subject = parseSubject(raw);
  // "creature or Vehicle" has no top-level type: its branches are the filter (#1266).
  return subject.type !== undefined || subject.subtype !== undefined || (subject.anyOf?.length ?? 0) > 0 ? subject : undefined;
}

/** Types and subtypes across EVERY face, deduped.
 *
 *  Splitting on the em dash alone treated a joined line as one face, so face 2 was swallowed into
 *  face 1's subtypes: "Creature — Dog Warlock // Instant" produced
 *  subtypes ["dog","warlock","//","instant"] and did NOT type the card as an instant. That is a
 *  missing type plus separator junk on 116 of the 2,544 calibration cards — every multi-face one.
 *
 *  Both faces contribute, because the card genuinely has both: an Instant // Land is a land you can
 *  play AND an instant you can cast, and a subject filtering on either type should match it. */
export function splitTypeLine(typeLine: string): [string[], string[]] {
  const words = (s: string): string[] =>
    s.trim().split(/\s+/).filter(Boolean).map((w) => w.toLowerCase());

  const types: string[] = [];
  const subtypes: string[] = [];
  for (const face of typeLine.split(FACE_SEP)) {
    const [typesPart, subtypesPart = ""] = face.split(TYPE_SUBTYPE_SEP);
    for (const w of words(typesPart)) if (!types.includes(w)) types.push(w);
    // "Time Lord" is ONE subtype, not two -- see joinMultiWordSubtypes.
    for (const w of joinMultiWordSubtypes(words(subtypesPart))) if (!subtypes.includes(w)) subtypes.push(w);
  }
  return [types, subtypes];
}
