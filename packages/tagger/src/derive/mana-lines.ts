/** MANA LINES: how a card puts mana, or a mana source, in front of you -- read ONCE, here (#1169).
 *
 *  The engine had ten places deciding "does this card make mana, and which" (inventory,
 *  docs/measurements/mana-detectors-inventory-2026-10-10.md), each with its own regex over the printed text, and they
 *  disagreed on real cards (Smokebraider counted as a WUBRG source, Phyrexian Altar too, Birgi a goldfish dork). This
 *  is the one reader. It runs AFTER the abilities are derived and reads what derivation already reads:
 *  - the stored / grammar CLAUSE RECORDS: the `add-mana` action's object ("one mana of any color", "{U}{U}, {U}{R}, or
 *    {R}{R}"), the clause's ability type and trigger;
 *  - the CLAUSE TEXT and COST `segment()` printed (`clauseTexts`, `clauseCosts`): the cost ("{1}, {T}", "Sacrifice a
 *    creature") and the sentence's restriction ("Spend this mana only to cast ...") and gate ("Activate only if ...").
 *    The clause layer keeps NEITHER (a restriction is the verb `other`, and the model path drops the sentence), so
 *    they are read from the printed clause, never from the whole oracle text;
 *  - the DERIVED ABILITIES: `repeats`, and the token-making and land-fetching abilities.
 *  No second pass over `oracleText`.
 *
 *  A line STATES, and a consumer JUDGES. Whether a line is a colour source, cheap ramp or a goldfish dork is each
 *  consumer's policy over these fields (the plan's owner rulings); nothing here decides it.
 *
 *  ONE READER OF "HOW MUCH IT ADDS" (#1193, DERIVE_VERSION 311): `production()` below. `ManaLine.amount` is its result and derive.ts sets `Ability.amount` from the
 *  same call (`manaAdded`), so the two cannot disagree. A SCALING amount ("X", "for each ...", "that much") has no number: the line names what it counts and the
 *  ability keeps the clause's own text, or nothing. `research/mana/amount-agreement.ts` measures the agreement.  */
import type { ClauseRecord } from "../canonicalize.js";
import type {
  Ability, Characteristics, LandFetch, ManaAnyColour, ManaGate, ManaLine, ManaLineSource, StaticFixer, SubjectFilter,
} from "../schema.js";
import { isEnergyObject } from "./effect-kind.js";
import { parseGate } from "./gate.js";

const WUBRG = ["W", "U", "B", "R", "G"] as const;
const NUMBER_WORD: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const WORD = "one|two|three|four|five|six|seven|eight|nine|ten";

export interface ManaInput {
  clauses: ClauseRecord[];
  /** The FINAL derived abilities (after `spellOnce`), so `repeats` is the one the matcher reads. */
  abilities: Ability[];
  chars: Characteristics;
  name?: string;
  /** Clause id -> printed text, in the form `textForClause` returns. */
  textOf: (clause: ClauseRecord) => string;
  clauseCosts?: Record<number, string>;
  clauseFaces?: Record<number, number>;
  /** Granted clause id -> the clause that grants it ("Lands you control have that ability" -> the quoted ability). */
  clauseGrants?: Record<number, number>;
  /** Clause ids granted to a token the same clause creates. */
  grantedToken?: ReadonlySet<number>;
  /** The printed mana cost of each face (index = face), "" when it prints none. Absent: only `chars.cmc` is known. */
  manaCosts?: string[];
  /** The printed text, for the two facts about an Aura the clause layer does not carry: whom it enchants ("Enchant creature an opponent controls") and
   *  what it takes from the permanent ("loses all other card types"). */
  oracleText?: string;
  /** The printed STARTING LOYALTY of each face (index = face, null for a face with none): from the card document, as ingested (owner 2026-10-13). Absent: a card that is no planeswalker. */
  startLoyalty?: (number | null)[];
}

/** The optional `CardTags` keys this module writes, each present only when the card has it. A writer that `$set`s the tags
 *  must `$unset` the ones a card no longer has, or a re-derive cannot retract a line (derive-corpus does). */
export const MANA_TAG_KEYS = ["manaLines", "staticFixer", "landFetch", "isOneShot", "suspendOnly"] as const;

export interface ManaResult {
  manaLines?: ManaLine[];
  staticFixer?: StaticFixer;
  landFetch?: LandFetch;
  isOneShot?: true;
  suspendOnly?: true;
}

/** A LOYALTY COST as the cost piece stores it: "+2", "0", "−1" (U+2212, the printed minus) -- "−X" is a cost no loyalty can be compared with. */
const LOYALTY_COST = /^(?:\+\d+|0|[\u2212-]\d+)$/;
/** THE LOYALTY-COST MANA LINES THAT CARRY NO STARTING LOYALTY: a walker whose loyalty the card document does not give (an ingest that predates it, "X" or "*" printed). A
 *  consumer reads a negative one as unusable (`loyaltyActivations`), so each is a source silently dropped -- `derive-corpus` prints the count (expected 0) and a test fails
 *  on one in the fixtures. */
export const unpricedLoyaltyLines = (lines: readonly ManaLine[] | undefined): ManaLine[] =>
  (lines ?? []).filter((l) => l.cost.other.length === 1 && LOYALTY_COST.test(l.cost.other[0]!) && l.startLoyalty === undefined);

/** THE AURA IS REMOVAL, not ramp (owner, 2026-10-13: "mana counts only if mana is the card's purpose"): it enchants a permanent an opponent controls
 *  (Honest Work: "Enchant creature an opponent controls") or takes the permanent's card types away (Imprisoned in the Moon: "loses all other card types and
 *  abilities", which leaves a land that happens to tap for {C}) or forbids the creature to attack or block (Utopia Vow, a pacifism). The ramp Auras give a permanent YOU control an ability and take nothing but its own land
 *  types (Lithoform Blight: "loses all land types and abilities") or nothing at all. CEILING: a text test, not a reading of what the Aura is for. */
const ENCHANTS_OPPONENTS = /^enchant [^\n]*\bopponent controls\b/im;
const STRIPS_CARD_TYPES = /\bloses all (?:other )?card types\b/i;
/** A PACIFISM beside the grant (owner 2026-10-13: "Utopia Vow ... pacifism purpose", where Karametra's Favor and Multani's Harmony are ramp): the Aura says the enchanted
 *  creature "can't attack or block". CEILING: a text test for that one sentence, not a reading of every way an Aura can disable its creature. */
const PACIFISM = /\benchanted creature can't attack or block\b/i;

const inWubrgOrder = (cs: Iterable<string>): string[] => { const s = new Set(cs); return WUBRG.filter((c) => s.has(c)); };
const faceOf = (id: number | string, faces?: Record<number, number>): 0 | 1 => ((faces?.[Number.parseInt(String(id), 10)] ?? 0) > 0 ? 1 : 0);

/** The mana value a mana cost string prints: a number is that many, X is 0, every other symbol is 1 (a `{2/W}` hybrid 2). */
export function manaValueOf(cost: string | undefined): number {
  let n = 0;
  for (const m of (cost ?? "").matchAll(/\{([^}]+)\}/g)) {
    const s = m[1]!.toUpperCase();
    n += /^\d+$/.test(s) ? Number(s) : s === "X" ? 0 : /^2\//.test(s) ? 2 : 1;
  }
  return n;
}

// ---------------------------------------------------------------------------------------------------------------
// The cost
// ---------------------------------------------------------------------------------------------------------------

type Cost = ManaLine["cost"];
const noCost = (): Cost => ({ mana: 0, tap: false, sacrificeSelf: false, sacrificeOther: false, life: 0, counters: null, tapOther: false, other: [] });

/** The pieces of an activation cost, comma-separated outside braces: "{1}, {T}", "{T}, Sacrifice two other
 *  creatures", "Pay 1 life". Mana symbols hold no comma, so a plain split is right. */
export function parseCost(cost: string | undefined, selfNames: readonly string[]): Cost {
  const out = noCost();
  for (const raw of (cost ?? "").split(",")) {
    const piece = raw.trim();
    if (piece === "") continue;
    if (/^(?:\{[^}]+\})+$/.test(piece)) {
      // CEILING: only MANA symbols are a mana cost. {X} is 0, a hybrid or Phyrexian symbol is 1 whichever way it is
      // paid, and {E} / {Q} are listed as `other`.
      for (const m of piece.matchAll(/\{([^}]+)\}/g)) {
        const s = m[1]!.toUpperCase();
        if (s === "T") out.tap = true;
        else if (s === "Q" || s === "E") out.other.push(`{${s}}`);
        else out.mana += /^\d+$/.test(s) ? Number(s) : s === "X" ? 0 : 1;
      }
      continue;
    }
    const life = /^pay (\d+|x) life$/i.exec(piece);
    if (life) { out.life += /^\d+$/.test(life[1]!) ? Number(life[1]) : 0; continue; }
    if (/^sacrifice\b/i.test(piece)) {
      const target = piece.replace(/^sacrifice\s+/i, "").toLowerCase();
      const itself = /^(?:this\b|it$|itself$|~)/.test(target) || selfNames.some((n) => n !== "" && target.startsWith(n));
      if (itself) out.sacrificeSelf = true; else out.sacrificeOther = true;
      continue;
    }
    // A counter removed or put as the cost (Cryptic Trilobite, Wall of Roots), and other permanents tapped (Springleaf Drum),
    // are structured so no consumer has to read `other`.
    // EXILING THE CARD ITSELF IS SACRIFICING IT (Ether: "{T}, Exile this artifact: Add {U}"): the mana source is gone, a one-shot.
    // CEILING: "itself" is four printed shapes -- "this ..." not followed by "card from" ("this artifact", "this creature"; "this card from your
    // graveyard" is another card), a bare "it" or "itself", the "~" placeholder, or the card's own name (full or the part before a comma) as a
    // prefix. "Exile the top card of your library", "exile target ..." and every other phrasing stay in `other`, a consumed resource.
    // Exiling OTHER cards (a card from a graveyard, Molt Tender) is a consumed resource and stays in `other`.
    if (/^exile\b/i.test(piece)) {
      const target = piece.replace(/^exile\s+/i, "").toLowerCase();
      const itself = /^(?:this\b(?!\s+card from)|it$|itself$|~)/.test(target) || selfNames.some((n) => n !== "" && target.startsWith(n));
      if (itself) { out.sacrificeSelf = true; continue; }
    }
    const counter = /^(remove|put)\b[^.]*\bcounters?\b/i.exec(piece);
    if (counter) { out.counters = counter[1]!.toLowerCase() as "remove" | "put"; continue; }
    if (/^tap (?:an?|one|two|three|\d+|x|any number of|target)\b[^.]*\buntapped\b/i.test(piece)) { out.tapOther = true; continue; }
    out.other.push(piece);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// What a line makes
// ---------------------------------------------------------------------------------------------------------------

const LEADING_COUNT = new RegExp(`^(${WORD}|\\d+)\\s+(?:\\{[^}]+\\})+$`, "i");
const SCALES = /\b(for each|equal to|that (?:many|much)|number of|where x)\b[^.]*|\{X\}|\bX\b/;

/** What `object` ("one mana of any color", "{U}{U}, {U}{R}, or {R}{R}", "five mana in any combination of colors")
 *  makes, alternative by alternative. */
export function production(object: string, amountText = "", context = ""): Pick<ManaLine, "colours" | "colourless" | "anyColour" | "amount"> {
  // A RESTRICTION SENTENCE THE MODEL LEFT ON THE OBJECT ("two mana of any one color. Spend this mana only to cast spells with mana value 4 or greater",
  // Ashling, Rimebound) is read by `restrictionOf`, not here: its "or" split the alternatives and left the amount unknown. Joined by a comma instead
  // ("two mana of any one color, spendable only to activate abilities of creature sources", Shang-Chi) it is the same rider.
  const stripped = object.replace(/[.,]\s*(?:spend (?:this|that|the) mana only|spendable only|this mana can'?t be spent)\b.*$/is, "").trim();
  // THE MODEL FILES THE MANA ON `amount` WHEN THE OBJECT NAMES THE RECIPIENT ("chosen player" + amount "{G}{G}{G}", Valleymaker): the symbols are the object.
  const at = amountText.trim().toLowerCase();
  const text = /^(?:\{[^}]+\})+$/.test(at) && !/\{[^}]+\}/.test(stripped) ? amountText.trim() : stripped;
  const lower = text.toLowerCase();
  // "two mana in any combination of {U}, {B}, and/or {R}" (Relic of Sauron) is ONE alternative of that many mana: the commas list the colours it may
  // be made of, not separate alternatives, and splitting on them read an amount of 1.
  const combination = new RegExp(`^(${WORD})\\s+mana\\s+in\\s+any\\s+combination\\s+of\\s+(?:\\{[^}]+\\}[\\s,/]*|and/or\\s*|or\\s*|and\\s*)+$`, "i").exec(text);
  // Whitespace is collapsed first so the split needs no unbounded `\s*` on both sides of a separator (CodeQL js/polynomial-redos on runs of spaces).
  // "{W}{W}, {U}{U}, {B}{B}, {R}{R}, and {G}{G}" (Terra) is a SUM: a list joined by "and" and offering no "or" is not alternatives, so it stays one.
  // CEILING: a list that mixes "and" and "or" is split on the "or" and the commas as before.
  const collapsed = text.replace(/\s+/g, " ");
  const alts = combination || (!/ or /i.test(collapsed) && / and /i.test(collapsed)) ? [text] : collapsed.split(/ ?, ?or | ?, | or /i).filter((a) => a.trim() !== "");
  const amountNum = /^\d+$/.test(at) ? Number(at) : NUMBER_WORD[at];
  const colours = new Set<string>();
  let colourless = 0;
  const counts: (number | undefined)[] = [];
  for (const alt of alts) {
    const symbols = [...alt.matchAll(/\{([WUBRGC](?:\/[WUBRGCP])?)\}/gi)].map((m) => m[1]!.toUpperCase());
    for (const s of symbols) for (const c of s.split("/")) if ((WUBRG as readonly string[]).includes(c)) colours.add(c);
    colourless = Math.max(colourless, symbols.filter((s) => s === "C").length);
    const word = new RegExp(`\\b(${WORD})\\s+mana\\b`, "i").exec(alt)?.[1]?.toLowerCase();
    // THE CLAUSE'S OWN COUNT is the amount of a lone alternative that states none: "{R}" with amount "6" (Chandra, Heart of Fire), "mana of any one color" with
    // amount "10" (The Aetherspark). A count printed in the object (a number word, two or more symbols) is not overridden.
    // "seven {R}" (the grammar's form of "Add seven {R}", Irencrag Feat, Avatar Roku) is that many times the symbols after it.
    const times = symbols.length > 0 ? LEADING_COUNT.exec(alt.trim()) : null; // {E} is no mana symbol: "eight {E}" counts nothing
    const stated = combination ? NUMBER_WORD[combination[1]!.toLowerCase()]
      : times ? (/^\d+$/.test(times[1]!) ? Number(times[1]) : NUMBER_WORD[times[1]!.toLowerCase()]!) * symbols.length
      : word ? NUMBER_WORD[word] : undefined;
    const clauseCount = alts.length === 1 && symbols.length <= 1 && stated === undefined ? amountNum : undefined;
    // CEILING: a bare "mana" (Piracy: "you may tap lands you don't control for mana") adds no amount; "mana of any color" with no count is one.
    counts.push(stated ?? (symbols.length > 1 ? symbols.length : clauseCount ?? (symbols.length === 1 ? 1 : /^(?:an? )?(?:additional )?mana\b/i.test(alt) && alt.trim().toLowerCase() !== "mana" ? 1 : undefined)));
  }
  let anyColour: ManaAnyColour | null = null;
  if (/commander'?s color identity/.test(lower)) anyColour = "identity";
  // BOUNDED BY WHAT YOU CONTROL OR HAVE EXILED, not by the card: "any color among legendary permanents you control" (Plaza of Heroes,
  // Mox Amber), "for each color among permanents you control" (Faeburrow Elder, Bloom Tender), "any of the exiled card's colors" (Chrome Mox).
  else if (/\bcolou?rs? among\b|\bexiled cards?'?s?'? colou?rs?\b/.test(lower)) anyColour = "among";
  // ...or by something you own: "any of this creature's colors" (Tazri, Katilda), "Choose a color of a permanent you control" (Meteor Crater),
  // "Choose a color of a card in your graveyard" (Corrupted Grafstone). Read on the whole sentence, since the choice is printed before the add.
  else if (/\bany of this creature'?s colou?rs\b|\bcolou?r of (?:a|an) (?:permanent|card|creature)s? (?:you control|in your graveyard)\b/.test(`${lower} ${context.toLowerCase()}`)) anyColour = "among";
  // "As you create your deck, circle two of the colors" (Cryptic Spires): chosen outside the card, like a chosen colour.
  else if (/\bcircled colou?rs\b/.test(lower)) anyColour = "chosen";
  // "Choose a color. Add one mana of that color for each ..." (Selvala, Astral Cornucopia, Three Tree City): any colour, the amount scales.
  else if (/\bof that colou?r\b/.test(lower) && /\bchoose a colou?r\b(?! of)/.test(context.toLowerCase())) anyColour = "any";
  else if (/\ba chosen colou?r\b/.test(lower)) anyColour = "any";
  // The colour is chosen AS PART OF THE ABILITY, in the same clause ("{T}: Choose a color. Add one mana of that color ...", Loot the Nexus,
  // Rhystic Cave, Nyx Lotus, Nykthos): a free choice each time, any colour. "As ~ enters, choose a color" is another clause and stays `chosen`.
  // The sentence must be exactly "Choose a color.", which refuses "choose a color other than white" (Thriving lands).
  else if (/\bthe chosen colou?r\b|\bcolou?r of your choice\b|\bthat colou?r\b/.test(lower) && /(?:^|[.:]\s*)choose a colou?r\s*\./.test(context.toLowerCase())) anyColour = "any";
  else if (/\bthe chosen (?:color|type)\b|\bcolor of your choice\b/.test(lower)) anyColour = "chosen";
  else if (/\bcould produce\b/.test(lower)) anyColour = /\bopponents?\b/.test(lower) ? "opponent-lands" : /\b(?:lands?|gates?)\b/.test(lower) ? "lands-you-could" : null;
  else if (/\bany (?:one )?(?:color|type)\b|\bany combination of colou?rs\b|\bany colou?r\b|\bdifferent colou?rs\b/.test(lower)) anyColour = "any";
  if (anyColour === "any") for (const c of WUBRG) colours.add(c);
  // The grammar path keeps "for each creature you control" on `action.amount`, the model path in the object. A number word or
  // digit there ("four", Cosmic Crucible) is a fixed amount; any other non-symbol text ("the greatest power among creatures you
  // control", Bighorner Rancher) is a count of something. `{X}` (Halo Forager) scales deliberately: X is chosen when it is paid,
  // so the line is named `scales: "x"` and never given a fixed number.
  const found = SCALES.exec(`${text} ${amountText}`.trim());
  const scale = found
    ? ([found[0].toLowerCase() === "{x}" ? "x" : found[0]] as RegExpExecArray)
    : at !== "" && amountNum === undefined && !/^(?:\{[^}]+\})+$/.test(at) ? ([at] as RegExpExecArray) : null;
  const known = counts.length > 0 && counts.every((n) => n !== undefined);
  return {
    colours: inWubrgOrder(colours), colourless, anyColour,
    amount: scale ? { fixed: null, scales: scale[0].trim().toLowerCase() } : { fixed: known ? Math.min(...(counts as number[])) : amountNum ?? null, scales: null },
  };
}

const RESTRICT_ONLY = /\bspend (?:this|that|the) mana only ((?:to|on|for)\b[^.]*)/i;
const RESTRICT_NOT = /\b(?:this|that) mana can'?t be spent ([^.]*)/i;
const NOT_A_TYPE = new Set(["a", "an", "the", "of", "cast", "your", "that", "those", "these", "or", "and", "each", "any", "other", "this", "spend"]);

/** "Spend this mana only to cast ..." / "This mana can't be spent to cast ...": the limit as printed (lowercased), and
 *  the one type it names. The rider after the limit ("..., and that spell can't be countered", Cavern of Souls) is not
 *  part of it. */
function restrictionOf(texts: readonly string[]): ManaLine["restriction"] {
  for (const t of texts) {
    const only = RESTRICT_ONLY.exec(t);
    const not = only ? null : RESTRICT_NOT.exec(t);
    const raw = only?.[1] ?? (not ? `can't be spent ${not[1]}` : undefined);
    if (!raw) continue;
    const spend = raw.replace(/\s+/g, " ").replace(/,? and (?:that|it|those)\b.*$/i, "").trim().toLowerCase();
    const type = /\bof the chosen type\b/.test(spend) ? "chosen" : [...spend.matchAll(/\b([a-z'-]+)\s+spells?\b/g)].map((m) => m[1]!).find((w) => !NOT_A_TYPE.has(w));
    return type ? { spend, typeName: type } : { spend };
  }
  return null;
}

/** The cost of an activated ability the segmenter did not split: the text before its colon, when that head is one sentence
 *  and the body after it adds mana. Linear (an `indexOf`, not a regex over the whole line). */
function colonHead(text: string): string {
  const i = text.indexOf(":");
  if (i <= 0 || text.slice(0, i).includes(".") || !/^\s*add\b/i.test(text.slice(i + 1))) return "";
  return text.slice(0, i).trim();
}

/** THE GATE, TYPED (#1191): every place below builds the verbatim lowercase condition; this is where it becomes a `ManaGate`, once (`parseGate`, derive/gate.ts). */
const typedGate = (g: string | null): ManaGate | null => (g === null ? null : parseGate(g));
const GATE = /\bactivate (?:this ability )?only (?:if|when|while) ([^.]*)/i;
const sentencesOf = (text: string): string[] => text.split(/(?<=[.!?])\s+/).filter((x) => x.trim() !== "");
/** A sentence that adds mana (a symbol or the word "mana" after "add"), as opposed to "add a +1/+1 counter". */
const ADDS_MANA = /\badd\b[^.]*(?:\{[WUBRGCX]|\bmana\b)/i;
const YOU_DO = /^(?:you|they|that player) do$/i;
// A CONDITIONAL LINE holds only under its condition, so it is gated, never credited as guaranteed: Cabal Ritual's "Add {B}{B}{B}{B}{B}
// instead if there are seven or more cards in your graveyard", Urza's Tower's "If you control an Urza's Mine and an Urza's
// Power-Plant, add {C}{C}{C} instead", Gemstone Caverns' "If ~ has a luck counter on it, instead add one mana of any color", an
// intervening if ("When this creature enters, if you attacked this turn, add {R}{W}{B}"), "Add {G}{G} if you control a Forest".
// Read on the sentence that holds THIS add (one clause can hold the plain line and its instead line), after the "Activate only
// if" clause of the whole text. "If you do" is never a gate: it points back at a cost (see `antecedentCost`).
const CONDITIONS = [
  /\bif ([^,]+),\s*(?:instead,?\s*)?(?:you may )?add\b/i,
  // "If you win, at the beginning of your next main phase, you may add ..." (Scattering Stroke)
  /\bif ([^,]+),\s[^,]*,\s(?:you (?:may )?)?add\b/i,
  /\binstead if ([^.]*)/i,
  /\badd\b[^.]*?\bif ([^.]*)/i,
];
const gateOf = (text: string, sentence: string, thresholdAbility: boolean): string | null => {
  const g = GATE.exec(text)?.[1] ?? CONDITIONS.map((r) => r.exec(sentence)?.[1]).find((x) => x !== undefined && !YOU_DO.test(x.trim()));
  return g ? g.trim().toLowerCase() : thresholdAbility ? "threshold" : null;
};
/** A GAME-STATE REQUIREMENT THE ABILITY WORD CARRIES (`Ability.requires`): "Max speed — {T}: Add {C}{C}" (Muraganda Raceway) holds only at speed 4, so the line is gated
 *  ("speed 4"), never credited as guaranteed. The segmenter strips the word from the clause text, which is why it is not in `gateOf`'s reach. */
const requiresGate = (ability: Ability | undefined): string | null => ability?.requires ? `${ability.requires.marker} ${ability.requires.min}` : null;
/** WHAT FIRES A TRIGGER LINE (`ManaLine.trigger`, `triggerSubject`): the clause's own event. ONE EXCEPTION, for a printed add the model split across two
 *  events and kept on the first: "Whenever this creature transforms into Ashling, Rimebound AND AT THE BEGINNING OF YOUR FIRST MAIN PHASE, add two mana
 *  of any one color" arrives as a transform clause carrying the add and a main-phase clause carrying only the flip, so the add would be named for the one
 *  flip. The beginning of a phase recurs, so the line is named for it. CEILING: read off the clause text, for the one printed shape ("... and at the
 *  beginning of <your ...> <upkeep | end step | main phase>, add"); a card printing it otherwise keeps its first event. */
const AND_AT_PHASE = /\band at the beginning of ((?:your|each|the)\b[^,]*?\b(upkeep|end step|main phase)\b[^,]*),\s*(?:you may )?add\b/i;
const firedBy = (trigger: { event?: string; subject?: string } | undefined, text: string): Pick<ManaLine, "trigger" | "triggerSubject"> => {
  const phase = trigger?.event && !["main-phase", "upkeep", "end-step"].includes(trigger.event) ? AND_AT_PHASE.exec(text) : null;
  if (!phase) return { trigger: trigger?.event ?? null, triggerSubject: trigger?.subject ?? null };
  const event = phase[2]!.toLowerCase() === "main phase" ? "main-phase" : phase[2]!.toLowerCase() === "end step" ? "end-step" : "upkeep";
  return { trigger: event, triggerSubject: phase[1]!.toLowerCase() };
};
/** "As long as <condition>, this creature has that ability" (Honored Hierarch, Mul Daya Channelers): the grant's condition.
 *  "FOR as long as <duration>" (Ultima, Kitesail Larcenist) is a duration of a grant, not a condition on the line: excluded. */
const AS_LONG_AS = /(?<!\bfor )\bas long as ([^,]*),/i;

/** "You may <do something>. If you do, add {C}" (Yavimaya Bloomsage "you may pay 1 life", Fire Lord Ozai "you may sacrifice another
 *  creature", Energy Tap "Tap target untapped creature you control"): what comes before "if you do" is the COST of the line, so it
 *  fills `cost` (parsed like a printed cost: life, sacrifice, counters, tapOther, the rest in `other`) and gates nothing. An
 *  antecedent that is itself conditional ("You may reveal that card if it has three or more colored mana symbols", Omnath) is a
 *  genuine condition and is returned as the gate. `what` picks the sentence that follows ("add" / "search"). */
function antecedentCost(text: string, what: RegExp, cost: Cost, selfNames: readonly string[]): string | null {
  const ss = sentencesOf(text);
  const i = ss.findIndex((x) => /\bif (?:you|they|that player) do\b/i.test(x) && what.test(x));
  if (i <= 0) return null;
  const prev = ss[i - 1]!.replace(/[.!?]+$/, "").replace(/^then\s+/i, "").trim();
  // "Then if there are three or more counters on it, sacrifice it. If you do, ..." (Charitable Levy): the if-part is the gate and
  // the part after the comma is the cost. "You may reveal that card if it has ..." (Omnath) has no comma: the whole tail is the gate.
  const split = /^if ([^,]*),\s*(.+)$/i.exec(prev);
  const cond = split?.[1] ?? /\bif ([^,]*)$/i.exec(prev)?.[1];
  if (cond && !split) return cond.trim().toLowerCase();
  const tail = split?.[2] ?? prev;
  const act = (/\b(?:you|they|that player) may (.+)$/i.exec(tail)?.[1] ?? tail.replace(/^(?:when|whenever|at the beginning of)\b[^,]*,\s*/i, "")).trim();
  const got = parseCost(act, selfNames);
  cost.mana += got.mana; cost.tap ||= got.tap; cost.life += got.life; cost.sacrificeSelf ||= got.sacrificeSelf;
  cost.sacrificeOther ||= got.sacrificeOther; cost.tapOther ||= got.tapOther; cost.counters ??= got.counters; cost.other.push(...got.other);
  return split ? split[1]!.trim().toLowerCase() : null;
}

/** Why a fetched land may not arrive: "If an opponent controls more lands than you, put it onto the battlefield" (Stoic Farmer),
 *  "... onto the battlefield tapped if you control a land named Wastes" (Ruin in Their Wake), "Each player who controls four or
 *  fewer lands may search" (Natural Balance), "An opponent chooses two of those cards" (Elemental Teachings).
 *  Only the put sentence under YOUR control counts: Verdant Mastery's "under an opponent's control if the {3}{G} cost was paid" is
 *  the opponent's land, not yours.
 *  CEILING: a heuristic over four printed shapes. The first put sentence wins, so a card with two conditional puts reads one; a
 *  condition split across sentences is missed; "if you do" is a cost (`antecedentCost`), never read here. */
function fetchGate(text: string): string | null {
  const put = sentencesOf(text).find((x) => /\bonto the battlefield\b/i.test(x) && !/\bunder an opponent'?s? control\b/i.test(x)) ?? "";
  const g = [/^if ([^,]+), /i.exec(put)?.[1], /\bonto the battlefield\b[^.]*?\bif ([^.]*)/i.exec(put)?.[1],
    /\beach player who ([^,.]*?) (?:may )?search/i.exec(text)?.[1], /(an opponent chooses [^.]*)/i.exec(text)?.[1]]
    .find((x) => x !== undefined && !YOU_DO.test(x.trim()));
  return g ? g.trim().toLowerCase() : null;
}
/** A TAP BONUS FOR ONE TURN (High Tide, Bubbling Muck): "Until end of turn, whenever <a player | you> taps <a land filter> for mana, <that player | you> adds an additional {U}".
 *  Read off the clause TEXT because the grammar path keeps the tap as a condition of the add and the model path as a trigger -- the same card, two records. Group 1 is the
 *  filter ("an Island"). CEILING: the one printed shape; a spell that waits for a tap in any other words is not read, and banks no line. Pyre Rhymer // Molten Tide, whose add the
 *  model filed under `effectActions` (which the canonical record drops), has its add read off this same text. */
const ONE_TURN_TAP_BONUS = /^until end of turn, whenever (?:a player|you) taps? (an? [^,]*?) for mana, (?:that player|you)? ?adds? an additional\b/i;
const QUOTED = /"[^"]*"/g;
/** `ADDS_MANA`, also for "that player ADDS an additional {U}". */
const ADDS_MANA_OR_S = /\badds?\b[^.]*(?:\{[WUBRGCX]|\bmana\b)/i;
const DELAYED = /\b(?:at the beginning of|on) (?:your |the )?next [^,.]*,?[^.]*\badd\b|\badd\b[^.]*\bat the beginning of (?:your |the )?next\b/i;

// ---------------------------------------------------------------------------------------------------------------
// Token and land makers
// ---------------------------------------------------------------------------------------------------------------

/** Tokens that are themselves a mana source, by the subtype the token-generation subject carries. */
const MANA_TOKENS: Record<string, Pick<ManaLine, "colours" | "colourless" | "anyColour" | "restriction">> = {
  treasure: { colours: [...WUBRG], colourless: 0, anyColour: "any", restriction: null },
  gold: { colours: [...WUBRG], colourless: 0, anyColour: "any", restriction: null },
  powerstone: { colours: [], colourless: 1, anyColour: null, restriction: { spend: "can't be spent to cast a nonartifact spell", typeName: "artifact" } },
  "eldrazi-spawn": { colours: [], colourless: 1, anyColour: null, restriction: null },
  "eldrazi-scion": { colours: [], colourless: 1, anyColour: null, restriction: null },
  // A LANDER IS A LAND-FETCH TOKEN, not a mana one (owner 2026-10-13, #1190: "a land-fetch token like Treasure is a mana token; its makers keep the Ramp role"): "{2}, {T}, Sacrifice this token:
  // Search your library for a basic land card, put it onto the battlefield tapped". It states no mana, so its colours are empty and the line is no colour source (a token-maker never is).
  lander: { colours: [], colourless: 0, anyColour: null, restriction: null },
};
const tokenKeyOne = (sub: string): string | null => {
  const key = sub.toLowerCase();
  if (key === "eldrazi-spawn" || key === "spawn-eldrazi") return "eldrazi-spawn";
  if (key === "eldrazi-scion" || key === "scion-eldrazi") return "eldrazi-scion";
  return key in MANA_TOKENS ? key : null;
};
/** THE MANA (OR LAND-FETCH) TOKEN A TOKEN-GENERATION SUBJECT NAMES. A single subtype, a CHOICE ("a Food token or a Treasure token", Tireless Provisioner: the subtype is the list ["food","treasure"]), or a
 *  token beside another (Song of Eärendil's Treasure and Bird: `anyOf`). A choice that includes a mana token counts (owner 2026-10-13, #1190: "read their Treasure as a token-maker line").
 *  CEILING: the first mana token found; a choice of Treasure or Gold names one line. */
const tokenKey = (sub: SubjectFilter["subtype"], anyOf?: readonly Partial<SubjectFilter>[]): string | null => {
  const names = [Array.isArray(sub) ? sub : sub ? [sub] : [], ...(anyOf ?? []).map((o) => (Array.isArray(o.subtype) ? o.subtype : o.subtype ? [o.subtype] : []))].flat();
  const joined = Array.isArray(sub) ? tokenKeyOne(sub.join("-")) : null;
  return joined ?? names.map(tokenKeyOne).find((k): k is string => k !== null) ?? null;
};

/** WHO GETS THE TOKEN, from the printed words (a token-maker line carries no recipient of its own, and the grammar types "an opponent creates" as `any`): "an opponent creates two Treasure tokens"
 *  (Ingenious Mastery), "each opponent who voted ... creates a Treasure token" (Erestor of the Council) hand the mana to the OTHER side of the table, and an opponent's Treasure is not your ramp
 *  (owner 2026-10-13, #1190). `YOU_CREATE` is the other half: "you create" (Tempting Contract's second sentence), "you and target opponent each create" (Thran Spider), "each player creates"
 *  (Marching Duodrone), "that attacking player creates" (Jolene: any player attacking your opponents, you included), "target player creates" (Prismari Command: you may name yourself). */
const OPP_RECIPIENT = /\b(?:an?|each|target|defending|those) opponents?(?:\s+who\s+[^.,]*?|\s+may)?\s+creates?\b|\b(?:its|their|that (?:creature|permanent|spell)'s) controller(?:\s+may)?\s+creates?\b/i;
const YOU_CREATE = /\byou (?:may )?create\b|\byou and [^.]*\bcreate\b|\beach player (?:may )?creates?\b|\b(?:that|target|each) (?:attacking )?player (?:may )?creates?\b/i;
/** A sentence about TOKEN CREATION being replaced or doubled makes none (Xorn, Jolene's "plus an additional Treasure token") unless it ADDS a mana token to another's creation (`replacementAddedToken`). */
const REPLACES_CREATION = /\bif you would create\b|\binstead create\b|\bthose tokens plus\b/i;
/** THE MANA TOKEN A CREATION REPLACEMENT ADDS TO THE CREATION OF A DIFFERENT TOKEN (owner 2026-10-14, #1197): "If you would create a Food token, instead create a Food token and a Treasure token" (Bilbo,
 *  Fellow Conspirator), "If you would create a Clue, Food, or Treasure token, instead create one of each" (Academy Manufactor: a Clue or a Food made yields a Treasure). A doubler of the Treasure you
 *  are already making ("instead create those tokens plus an additional Treasure token", Xorn; Jolene's second sentence) makes none without another maker, and is no line.
 *  Both templates are read: the active "If you would create X, instead create ..." and the passive "If one or more X would be created ..., those tokens plus an additional Y token are created instead".
 *  The replaced part is what stands before its first "token(s)": a token NAME in it that is not the mana token (REPLACED_TOKEN_NAMES, a positive list) makes the added mana token a maker; no name at all is
 *  every token ("one or more tokens", Tippy-Toe's shape), which also makes it one; the mana token alone is a doubler. Qualifiers after "tokens" ("under your control") are never read.
 *  CEILING: a replaced token that is a creature type or any name outside REPLACED_TOKEN_NAMES (Soldier, Thopter) is not recognised, so a replacement over it adds no line; "one of each" adds every token named. A
 *  replaced "Treasure or Gold" that adds a Treasure reads as a maker (Gold is another name), though it only doubles mana tokens; no card prints it. */
const REPLACED_FILLER = new Set(["if", "you", "would", "create", "be", "created", "a", "an", "one", "or", "more", "and", "of", "each", "the", "tapped", "untapped", "that", "many", "additional", "another"]);
const REPLACED_TOKEN_NAMES = new Set(["clue", "food", "blood", "map", "junk", "incubator", "role", "shard", "powerstone", "gold", "treasure", "lander", "mutagen", "eldrazi", "spawn", "scion"]);
const ADDED_MANA_TOKENS = ["treasure", "gold", "powerstone"] as const;
export function replacementAddedToken(text: string): string | null {
  const flat = text.replace(/\([^)]*\)/g, " ").toLowerCase();
  const at = flat.indexOf("instead create");
  const head = flat.indexOf("if you would create");
  let replacedText: string;
  let added: string;
  if (at >= 0 && head >= 0 && head <= at) {
    replacedText = flat.slice(head, at);
    // "instead create one of each" (Academy Manufactor) adds every token the replaced set names.
    added = /\bone of each\b/.test(flat.slice(at)) ? replacedText : flat.slice(at);
  } else {
    const would = flat.indexOf("would be created");
    const plus = flat.indexOf("those tokens plus");
    if (would < 0 || plus < would) return null;
    // From the replacement's own "If": an earlier sentence in the clause is not what is replaced.
    replacedText = flat.slice(Math.max(0, flat.lastIndexOf("if ", would)), would);
    added = flat.slice(plus);
  }
  const firstToken = replacedText.indexOf("token");
  const named = (firstToken < 0 ? replacedText : replacedText.slice(0, firstToken)).split(/[^a-z]+/).filter((w) => w !== "" && !REPLACED_FILLER.has(w));
  for (const key of ADDED_MANA_TOKENS) {
    if (!new RegExp(`\\b${key}\\b`).test(added)) continue;
    const others = named.filter((w) => w !== key && REPLACED_TOKEN_NAMES.has(w));
    // The mana token alone is a doubler (none); another token named, or every token (nothing named), adds it. An unrecognised name is none.
    if (others.length > 0 || named.length === 0) return key;
  }
  return null;
}
const handsTokenToOpponentOnly = (text: string, abilityControl: string | undefined): boolean =>
  (abilityControl === "opp" || OPP_RECIPIENT.test(text)) && !YOU_CREATE.test(text);
/** THE WHOLE CARD'S SENTENCES THAT NAME THE TOKEN decide first (reminder text stripped): a clause the segmenter cut short (Cityscape Leveler's attack trigger loses "Its controller creates a tapped Powerstone")
 *  would read as yours. The token is the opponent's only when EVERY sentence naming it hands it to an opponent. With no such sentence the clause's own words decide. */
const TOKEN_WORD: Record<string, string> = { treasure: "treasure", gold: "gold", powerstone: "powerstone", lander: "lander", "eldrazi-spawn": "eldrazi", "eldrazi-scion": "eldrazi" };
function opponentOnlyToken(oracleText: string, key: string, clauseText: string, abilityControl: string | undefined): boolean {
  const word = TOKEN_WORD[key];
  const named = word === undefined ? [] : sentencesOf(oracleText.replace(/\([^)]*\)/g, " ")).filter((x) => new RegExp(`\\b${word}`, "i").test(x) && /\bcreates?\b/i.test(x));
  // ...or the clause's own words say so (Generous Plunderer's "When you do, target opponent creates a tapped Treasure token" beside its own).
  if (handsTokenToOpponentOnly(clauseText, abilityControl)) return true;
  if (named.length > 0) return named.every((x) => OPP_RECIPIENT.test(x) && !YOU_CREATE.test(x));
  return false;
}
/** A "create" action in a clause the abilities did not turn into a token-generation of a mana token: the Treasure a Saga chapter makes beside a Bird, the one inside an Aura token's quoted trigger, one
 *  the model typed `static` with no subtype (Spiked Pit Trap). */
const CREATES_MANA_TOKEN = /\bcreates?\b[^.]*?\b(treasure|gold|powerstone|lander|eldrazi spawn|eldrazi scion)\b/i;
const LATER_LANDING = /\bput\b[^.]*?\b(?:that card|those cards?|one of those cards|it|them)\b[^.]*?\bonto the battlefield\b/i;
const landishSearch = (f?: SubjectFilter): boolean => f !== undefined && (f.type === "land" || f.basic === true);
/** "Until end of turn, you may tap lands you don't control for mana" (Piracy): mana with no "add" in the text, a spell's own. */
const TAPS_FOR_MANA = /\byou may tap [^.]*?\bfor mana\b/i;

const BASIC_COLOUR: Record<string, string> = { plains: "W", island: "U", swamp: "B", mountain: "R", forest: "G" };

/** The colours the lands a fetch finds can make. A basic land, or any land card, reaches all five; a named basic land
 *  type only its colour. CEILING: a fetch for a non-basic type (Desert, Gate, Cave) reaches nothing here. */
function reachOf(subject: SubjectFilter): string[] {
  const types = (Array.isArray(subject.subtype) ? subject.subtype : subject.subtype ? [subject.subtype] : []).map((s) => s.toLowerCase());
  if (types.length === 0) return [...WUBRG];
  return inWubrgOrder(types.map((t) => BASIC_COLOUR[t]).filter((c): c is string => c !== undefined));
}

// ---------------------------------------------------------------------------------------------------------------
// Static fixers (#1115)
// ---------------------------------------------------------------------------------------------------------------

// The same whole-sentence anchors the matcher's static-fixers.ts used, applied to ONE static CLAUSE's printed text:
// a sentence is a fixer only when it is the entire ability, which is what refuses a condition ("As long as you control
// six or more lands, ..."), a duration, a restriction and a one-spell grant without a list of exceptions.
const LANTERN_PARENT = /^lands you control have that ability\.?$/;
const EVERY_TYPE = /^lands you control are every basic land type in addition to their other types\.?$/;
const ONE_TYPE = /^(?:each land is|all lands are|lands you control are) (?:an? )?(plains|island|swamp|mountain|forest)(?:s|es)? in addition to (?:its|their) other (?:land )?types\.?$/;
const SPEND_ANY = /^(?:you|players) may spend mana as though it were mana of any (?:color|type)\.?$/;
const NOT_IN_A_DECK = new Set(["vanguard", "plane", "phenomenon", "conspiracy", "scheme", "ongoing scheme"]);

// ---------------------------------------------------------------------------------------------------------------

export function deriveMana(input: ManaInput): ManaResult {
  const { chars, abilities, clauses } = input;
  const selfNames = [(input.name ?? "").toLowerCase(), ...(input.name ?? "").split(" // ").map((n) => n.split(",")[0]!.trim().toLowerCase())].filter(Boolean);
  const faceMV = (face: number): number => (input.manaCosts ? manaValueOf(input.manaCosts[face] ?? input.manaCosts[0]) : chars.cmc);
  const lines: ManaLine[] = [];
  const removalAura = chars.subtypes.some((t) => t.toLowerCase() === "aura") && (ENCHANTS_OPPONENTS.test(input.oracleText ?? "") || STRIPS_CARD_TYPES.test(input.oracleText ?? "") || PACIFISM.test(input.oracleText ?? ""));

  // --- add-mana lines, one per action, in clause order -------------------------------------------------------
  for (const clause of clauses) {
    // "one energy" / "an amount of {E} ..." is the clause layer reading an energy counter as mana (Roil Cartographer,
    // Aetherflux Conduit); `isEnergyObject` refuses the bare `{E}` and these two are the other spellings.
    const text = input.textOf(clause);
    let adds = (clause.actions ?? []).filter((a) => a.verb === "add-mana" && !isEnergyObject(a.object ?? "") && !/\{E\}|\benergy\b/i.test(a.object ?? ""));
    // THE MODEL FILES A SPELL'S TAP BONUS UNDER `effectActions` (Pyre Rhymer // Molten Tide: `actions` = [tap this], `effectActions` = [add-mana {R}]), which the canonical record
    // drops, so the clause arrives with no add at all. The one-turn tap bonus is read off its printed text instead, as it is for High Tide: the symbols after "an additional".
    // CEILING: that one printed shape only; any other add the model filed under `effectActions` is still unseen.
    if (adds.length === 0 && clause.abilityType === "spell" && ONE_TURN_TAP_BONUS.test(text.trim())) {
      const symbols = /\badditional\s+((?:\{[^}]+\})+)/i.exec(text)?.[1];
      if (symbols) adds = [{ verb: "add-mana", object: symbols }];
    }
    if (adds.length === 0) continue;
    const id = clause.id;
    const texts = [text, ...(clause.actions ?? []).filter((a) => a.verb === "other").map((a) => a.object ?? "")].filter(Boolean);
    const matching = abilities.filter((a) => a.clause === id && a.effect.kind === "mana-generation");
    const face = faceOf(id, input.clauseFaces);
    const granted = input.clauseGrants?.[id as number] !== undefined;
    const trigger = clause.trigger?.event ? clause.trigger : undefined;
    const tokenGrant = input.grantedToken?.has(id as number) === true;
    // A COST MAKES IT ACTIVATED whatever the model typed: Wall of Roots, Aether Hub, Servant of the Conduit and The Golden
    // Throne came back `static`, and the segmenter does not split their cost either (a counter put, "Pay {E}"). The cost is
    // then the text before the colon. A static with no colon stays refused (Contamination: "it produces {B} instead").
    const costText = input.clauseCosts?.[id as number] ?? colonHead(text);
    const activated = clause.abilityType === "activated" || (clause.abilityType === "static" && costText !== "");
    const parent = granted ? clauses.find((c) => c.id === input.clauseGrants?.[id as number]) : undefined;
    // A GRANT MADE BY A TRIGGERED PARENT exists only once the trigger has happened (Princess Yue: "When ~ dies, ... She gains '{T}: Add {C}.'" -- the
    // mana is the Moon's, not the creature in play), so the trigger's own words gate the line, up to the first comma ("when princess yue dies").
    // "As long as" (a condition, or "for as long as", a duration) keeps its own reading above: the grant is then standing, not one a trigger starts.
    // A SAGA CHAPTER IS THE EXCEPTION unless it names a duration: "I -- This Saga gains '{T}: Add {C}.'" (Urza's Saga) lasts until the Saga goes, and
    // the chapter fires the turn it enters, so the land taps for {C} as a land would. A token a trigger creates is no grant to this card (`tokenGrant`).
    // CEILING: the gate says WHAT STARTS the grant, not for how long -- "until your next turn" (Song of Freyalise, Hydro-Man) is gated, never read as standing.
    const parentText = parent ? input.textOf(parent) : "";
    const triggeredStart = parent !== undefined && !tokenGrant && parent.abilityType === "triggered" && !/\bas long as\b/i.test(parentText)
      && !(parent.trigger?.event === "chapter" && !/\buntil\b/i.test(parentText));
    const grantGate = parent
      ? AS_LONG_AS.exec(parentText)?.[1]?.trim().toLowerCase() ?? (triggeredStart ? (parentText.split(",")[0]!.trim().toLowerCase() || "its trigger") : null)
      : null;
    // One entry per add. The model path sometimes keeps only the LAST of several printed adds (Gemstone Caverns: "Add {C}. If ~ has a
    // luck counter on it, instead add one mana of any color." is one action): the actions then align to the last mana-adding
    // sentences, and the leading ones ("Add {C}.") are read from their own text.
    // CEILING: when the text has fewer mana-adding sentences than actions, or the counts otherwise do not line up, every line is
    // given the WHOLE text as its sentence, so a condition printed on one of them may be read on all.
    const addSentences = sentencesOf(text).filter((x) => ADDS_MANA.test(x));
    const lead = addSentences.length > adds.length ? addSentences.length - adds.length : 0;
    const aligned = addSentences.length === adds.length + lead;
    const entries: { object: string; amountText: string; sentence: string; ability: Ability | undefined }[] = [];
    for (const sentence of addSentences.slice(0, lead)) {
      const m = /^add\s+((?:\{[^}]+\})+|(?:one|two|three|four|five|six|seven)\s+mana\b[^.]*)\.?$/i.exec(sentence.trim());
      if (m) entries.push({ object: m[1]!, amountText: "", sentence, ability: matching[0] });
    }
    for (const [k, action] of adds.entries()) {
      entries.push({ object: action.object ?? "", amountText: typeof action.amount === "string" ? action.amount : "",
        sentence: aligned ? addSentences[lead + k]! : text, ability: matching[k] });
    }
    for (const { object, amountText, sentence, ability } of entries) {
      const source: ManaLineSource | null =
        tokenGrant ? "token-maker"
        : granted ? "static-grant"
        : activated ? "activated"
        : clause.abilityType === "spell" ? "one-shot-spell"
        : clause.abilityType === "triggered"
          ? (trigger?.event === "tapped-for-mana" && /^(?:enchanted|equipped)\b/i.test(trigger.subject ?? "") ? "aura-trigger" : "trigger")
          // CEILING: a static ability that adds mana is printed by no card the corpus holds; refused, not guessed.
          : null;
      if (source === null) continue;
      // A SPELL'S ADD IS ITS OWN: an add that sits only inside a quoted ability belongs to the token or permanent the spell makes (Eldrazi Confluence's Scion: "Sacrifice this
      // token: Add {C}"). The token-maker line states it.
      if (source === "one-shot-spell" && !ADDS_MANA_OR_S.test(text.replace(QUOTED, "")) && !TAPS_FOR_MANA.test(text)) continue;
      // A SPELL THAT WAITS FOR A TAP is a tap bonus for the turn when it says so, and otherwise an unread trigger: banking its add as a plain one-shot (High Tide read as
      // "adds {U}, costs {U}, nets 0") is a guess where a refusal belongs.
      const oneTurn = source === "one-shot-spell" ? ONE_TURN_TAP_BONUS.exec(text.trim()) : null;
      if (source === "one-shot-spell" && trigger?.event === "tapped-for-mana" && oneTurn === null) continue;
      // A GRANT IS NOT ALWAYS A TAP ABILITY OR RAMP. A granted TRIGGER ("Enchanted creature has 'Whenever this creature deals combat damage to a player, add that
      // much {G}'", Mark of Sakiko) is no tap source, and an Aura that removes what it enchants is not mana for the deck.
      if (source === "static-grant" && ((clause.abilityType === "triggered" && trigger !== undefined) || removalAura)) continue;
      const made = production(object, amountText, text);
      // A GRANTED "{T}: Add one mana of any of this creature's colors" (Katilda) names the colours of each creature that has it. They are
      // neither the deck's nor the card's. CEILING: the grantees are each their own source and are not read; no colour is credited.
      if (source === "static-grant" && made.anyColour === "among" && /\bthis creature'?s colou?rs\b/i.test(object)) made.anyColour = "grantee";
      const cost = source === "activated" || source === "static-grant" || source === "token-maker"
        ? parseCost(costText, selfNames)
        : noCost();
      if (source === "one-shot-spell") cost.mana = faceMV(face);
      const afterCost = antecedentCost(text, ADDS_MANA, cost, selfNames);
      const produced = made.amount.fixed ?? 1;
      const line: ManaLine = {
        face, source, repeats: ability?.repeats ?? null, cost, ...made,
        unread: made.colours.length === 0 && made.colourless === 0 && made.anyColour === null,
        net: produced - cost.mana,
        gate: typedGate(grantGate ?? afterCost ?? requiresGate(ability) ?? gateOf(text, sentence, ability?.threshold !== undefined)),
        restriction: restrictionOf(texts),
        timing: source === "trigger" || source === "aura-trigger" || oneTurn ? "on-trigger" : DELAYED.test(text) ? "next-turn" : "now",
        producesToken: tokenGrant ? "granted" : null,
        ...(source === "trigger" || source === "aura-trigger" ? firedBy(trigger, text) : oneTurn ? { trigger: "tapped-for-mana", triggerSubject: oneTurn[1]!.trim(), untilEndOfTurn: true as const } : { trigger: null, triggerSubject: null }),
      };
      // ONE PRINTED ADD, TWO CLAUSES: "Whenever you cast or copy ..." (Ashling) arrives as a cast clause and a copy clause, each with the
      // same add. An identical trigger line is the same add read twice. CEILING: a card printing two identical trigger adds would merge; the
      // merged line keeps the first clause's `trigger` and `triggerSubject`.
      const sameAdd = (l: ManaLine): boolean => JSON.stringify({ ...l, trigger: null, triggerSubject: null }) === JSON.stringify({ ...line, trigger: null, triggerSubject: null });
      if ((source === "trigger" || source === "aura-trigger") && lines.some(sameAdd)) continue;
      lines.push(line);
    }
  }

  // --- token makers and land fetches, from the derived abilities --------------------------------------------
  const seenClauses = new Set<string>();
  let fetchKind: LandFetch["kind"] | null = null;
  let fetchTapped = true;
  const reach = new Set<string>();
  for (const a of abilities) {
    const face = (a.face ?? 0) > 0 ? 1 : 0;
    if (a.effect.kind === "token-generation") {
      const key = tokenKey(a.effect.subject?.subtype, a.effect.subject?.anyOf);
      if (key === null) continue;
      if (opponentOnlyToken(input.oracleText ?? "", key, input.textOf(clauses.find((c) => c.id === a.clause) ?? ({ id: -1 } as ClauseRecord)), a.effect.subject?.control)) continue;
      const dedupe = `token:${a.clause}:${key}`;
      if (seenClauses.has(dedupe)) continue;
      seenClauses.add(dedupe);
      const tokens = a.amount !== undefined && /^\d+$/.test(a.amount) ? Number(a.amount) : null;
      const cost = a.kind === "activated" ? parseCost(a.cost, selfNames) : noCost();
      if (a.kind === "on-cast") cost.mana = faceMV(face);
      const make = MANA_TOKENS[key]!;
      lines.push({
        face, source: "token-maker", repeats: a.repeats ?? null, cost, ...make, unread: false,
        // Each token is one use of mana when it is spent; a token count that scales is unknown.
        amount: tokens !== null ? { fixed: tokens, scales: null } : { fixed: null, scales: a.amount ?? null },
        net: (tokens ?? 1) - cost.mana, gate: null, timing: "now", producesToken: key, trigger: null, triggerSubject: null,
      });
      continue;
    }
    // A land SEARCHED out of the library by YOU onto the battlefield. The printed clause must say "search your library": that
    // refuses a dig ("look at the top six", Zimone's Experiment, Bounty of Skemfar) and a search by someone else ("target
    // opponent may search their library", Hired Giant; "each opponent", Old-Growth Dryads; "target player", Turtle Tracks,
    // Restorative Technique, Fertilid's Favor, which you could be the only searcher of but the text does not promise it).
    // The `enters` emit says where the land goes (the grammar path drops its library origin); the derived `search` carries the
    // type the model path leaves off the emit.
    const clauseText = input.textOf(clauses.find((c) => c.id === a.clause) ?? { id: -1 } as ClauseRecord);
    // YOU search, alone ("search your library") or with everyone ("each player may search their library": you get a land too).
    // "Target player" does not promise you the search and stays out.
    if (!/\bsearch your library\b|\beach player\b[^.]*?\bsearch(?:es)? their library\b/i.test(clauseText)) continue;
    const search = abilities.find((x) => x.clause === a.clause && x.effect.kind === "search");
    const found = search?.effect.subject;
    // Where the land goes: an `enters` emit; or, when the clause derives none (Myriad Landscape, Travel Through Caradhras), the
    // search itself with the printed "onto the battlefield".
    const landings: { subject: SubjectFilter; tapped: boolean }[] = [];
    for (const e of a.emits ?? []) {
      if (e.verb !== "enters" || (e.subject.fromZone !== undefined && e.subject.fromZone !== "library") || e.subject.control === "opp") continue;
      landings.push({ subject: e.subject, tapped: e.subject.entersTapped === true });
    }
    const hasEnters = abilities.some((x) => x.clause === a.clause && (x.emits ?? []).some((e) => e.verb === "enters" && e.subject.fromZone !== "battlefield"));
    if (landings.length === 0 && a.effect.kind === "search" && !hasEnters && /\bonto the battlefield\b/i.test(clauseText) && a.effect.subject?.control !== "opp") {
      landings.push({ subject: a.effect.subject ?? ({} as SubjectFilter), tapped: /\bonto the battlefield tapped\b/i.test(clauseText) });
    }
    // THE LAND IS PUT ONTO THE BATTLEFIELD IN A LATER CLAUSE (#1190): "search ..., put it into your hand. Morbid -- You may put that card onto the battlefield instead" (Caravan Vigil), the d20 table's
    // "Put one of those cards onto the battlefield tapped" (Druid of the Emerald Grove), "At the beginning of your end step, choose a card at random exiled with this enchantment and put it onto the
    // battlefield tapped" (Omenpath Journey). The later clause's own condition is the gate; a d20 table is gated on the roll.
    // CEILING: a later clause that puts "that card / those cards / it / them" onto the battlefield after YOUR land search; one that puts a different object there is not read.
    let laterGate: string | null | undefined;
    if (landings.length === 0 && a.effect.kind === "search" && !hasEnters && landishSearch(a.effect.subject) && a.effect.subject?.control !== "opp") {
      const later = clauses.find((c) => Number(c.id) > Number(a.clause) && faceOf(c.id, input.clauseFaces) === face && LATER_LANDING.test(input.textOf(c)));
      if (later) {
        const laterText = input.textOf(later);
        landings.push({ subject: a.effect.subject ?? ({} as SubjectFilter), tapped: /\bonto the battlefield tapped\b/i.test(laterText) });
        laterGate = fetchGate(laterText) ?? (/\broll(?:s)? an? d\d+\b/i.test(clauseText) ? "the d20 roll lets it onto the battlefield" : null);
      }
    }
    for (const { subject, tapped } of landings) {
      const named = [subject.subtype, found?.subtype].flat().filter((x): x is string => typeof x === "string").map((x) => x.toLowerCase());
      // A land: typed so, a basic, an "X or Desert card" (anyOf), or a basic land TYPE ("a Mountain card", Alpine Guide).
      const landish = (f?: SubjectFilter) => f !== undefined && (f.type === "land" || f.basic === true || (f.anyOf ?? []).some((o) => o.type === "land"));
      if (!(landish(subject) || landish(found) || named.some((n) => n in BASIC_COLOUR))) continue;
      const dedupe = `fetch:${a.clause}:${JSON.stringify(subject)}`;
      if (seenClauses.has(dedupe)) continue;
      seenClauses.add(dedupe);
      const lands = a.amount !== undefined && /^\d+$/.test(a.amount) ? Number(a.amount) : 1;
      const cost = a.kind === "activated" ? parseCost(a.cost, selfNames) : noCost();
      if (a.kind === "on-cast") cost.mana = faceMV(face);
      const afterCost = antecedentCost(clauseText, /\bsearch\b/i, cost, selfNames);
      const colours = reachOf({ ...found, ...subject, subtype: subject.subtype ?? found?.subtype } as SubjectFilter);
      // CEILING: a search for a non-basic type alone (Desert, Gate, Cave) reaches nothing here, and a fetch with no reach is not
      // emitted at all. A creature-or-land search (Archdruid's Charm) puts the land only conditionally and is not read.
      if (colours.length === 0 || (Array.isArray(subject.type) ? subject.type : [subject.type]).includes("creature")) continue;
      lines.push({
        face, source: "fetch", repeats: a.repeats ?? null, cost, colours, colourless: 0, anyColour: null, unread: false,
        amount: { fixed: lands, scales: null }, net: lands - cost.mana, gate: typedGate(afterCost ?? (laterGate !== undefined ? laterGate : fetchGate(clauseText))), restriction: null, timing: "now", producesToken: null, trigger: null, triggerSubject: null,
      });
      fetchKind = a.kind === "on-cast" || fetchKind === "spell" ? "spell" : "permanent";
      fetchTapped = fetchTapped && tapped;
      for (const c of colours) reach.add(c);
    }
  }

  // --- a mana token a CLAUSE creates that no ability named (#1190) ---------------------------------------------
  // The Treasure beside a Bird in a Saga chapter (when the ability's subject is read as the Bird), the one inside an Aura token's quoted trigger (Smoke Spirits' Aid), one a misread clause typed `static`
  // with no subtype (Spiked Pit Trap's 10-20 roll). Read off the clause's own "create" action, under the same recipient and replacement tests as the abilities above.
  // CEILING: a Treasure inside any quoted ability of a token the clause makes is credited to the card that makes the token, as the Aura's is.
  for (const c of clauses) {
    const text = input.textOf(c);
    const replaces = REPLACES_CREATION.test(text);
    const added = replaces ? replacementAddedToken(text) : null;
    if (replaces && added === null) continue;
    for (const action of replaces ? [{ verb: "create", object: `a ${added} token` }] : c.actions ?? []) {
      if (action.verb !== "create") continue;
      const m = CREATES_MANA_TOKEN.exec(`create ${action.object ?? ""}`);
      if (!m) continue;
      const key = tokenKeyOne(m[1]!.toLowerCase().replace(/\s+/g, "-"));
      if (key !== null && opponentOnlyToken(input.oracleText ?? "", key, text, abilities.find((ab) => ab.clause === c.id && ab.effect.kind === "token-generation")?.effect.subject?.control)) continue;
      if (key === null || seenClauses.has(`token:${c.id}:${key}`)) continue;
      // A token whose own quoted ability adds the mana is already a "granted" line (Vraska, Soul of Stone): the Treasure-subtyped creature is one token, not two.
      if (lines.some((l) => l.source === "token-maker" && l.producesToken === "granted" && l.face === faceOf(c.id, input.clauseFaces))) continue;
      seenClauses.add(`token:${c.id}:${key}`);
      const face = faceOf(c.id, input.clauseFaces);
      const own = abilities.find((ab) => ab.clause === c.id);
      const cost = c.abilityType === "activated" ? parseCost(input.clauseCosts?.[c.id as number] ?? colonHead(text), selfNames) : noCost();
      if (c.abilityType === "spell") cost.mana = faceMV(face);
      lines.push({
        face, source: "token-maker", repeats: own?.repeats ?? null, cost, ...MANA_TOKENS[key]!, unread: false,
        amount: { fixed: 1, scales: null }, net: 1 - cost.mana, gate: null, timing: "now", producesToken: key, trigger: null, triggerSubject: null,
      });
    }
  }

  // --- a planeswalker's starting loyalty, on each line that costs loyalty ---------------------------------------
  // A loyalty ability can be activated the turn the walker is cast only if its printed loyalty covers the cost (CR 606.6), so the consumer needs both.
  for (const l of lines) {
    const n = input.startLoyalty?.[l.face];
    if (n !== null && n !== undefined && l.cost.other.length === 1 && LOYALTY_COST.test(l.cost.other[0]!)) l.startLoyalty = n;
  }

  // --- the card-level facts ----------------------------------------------------------------------------------
  const result: ManaResult = {};
  if (lines.length > 0) result.manaLines = lines;
  if (fetchKind !== null) result.landFetch = { kind: fetchKind, tapped: fetchTapped, reach: inWubrgOrder(reach) };

  // A one-shot: every line is spent in the using, an instant or sorcery's mana or a source that sacrifices itself.
  // The mana lines only: a fetch or a Treasure-maker beside them does not make the card repeatable.
  const manaOnly = lines.filter((l) => l.source !== "fetch" && l.source !== "token-maker");
  if (manaOnly.length > 0 && manaOnly.every((l) => l.source === "one-shot-spell" || (l.source === "activated" && l.cost.sacrificeSelf))) result.isOneShot = true;

  // Suspend and no mana cost: only suspend puts it into play (Mox Tantalite, Lotus Bloom).
  if (input.manaCosts && (input.manaCosts[0] ?? "") === "" && (chars.keywords ?? []).some((k) => k.toLowerCase() === "suspend")
    && !chars.types.some((t) => t.toLowerCase() === "land")) result.suspendOnly = true;

  const fixer = staticFixerOf(input);
  if (fixer) result.staticFixer = fixer;
  return result;
}

function staticFixerOf(input: ManaInput): StaticFixer | null {
  if (input.chars.types.some((t) => NOT_IN_A_DECK.has(t.toLowerCase()))) return null;
  for (const clause of input.clauses) {
    // Front face only: a back face is another card on another turn.
    if (faceOf(clause.id, input.clauseFaces) !== 0 || clause.abilityType !== "static" || input.clauseGrants?.[clause.id as number] !== undefined) continue;
    const line = input.textOf(clause).replace(/\([^()]*\)/g, "").trim().toLowerCase();
    if (EVERY_TYPE.test(line)) return { covers: "lands", colours: [...WUBRG] };
    const one = ONE_TYPE.exec(line);
    if (one) return { covers: "lands", colours: [BASIC_COLOUR[one[1]!]!] };
    if (SPEND_ANY.test(line)) return { covers: "all", colours: [...WUBRG] };
    if (LANTERN_PARENT.test(line)) {
      // The grant is a fixer only if what it grants is the plain, unrestricted, free tap for any colour.
      const child = input.clauses.find((c) => input.clauseGrants?.[c.id as number] === clause.id);
      const action = (child?.actions ?? []).find((a) => a.verb === "add-mana");
      if (!child || !action) continue;
      const made = production(action.object ?? "");
      const cost = parseCost(input.clauseCosts?.[child.id as number], []);
      if (made.anyColour === "any" && made.amount.fixed === 1 && cost.tap && cost.mana === 0 && !cost.sacrificeSelf && !cost.sacrificeOther
        && restrictionOf([input.textOf(child)]) === null) return { covers: "lands", colours: [...WUBRG] };
    }
  }
  return null;
}
