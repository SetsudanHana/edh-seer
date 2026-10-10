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
 *  CEILING: `manaAdded` in derive.ts still computes `Ability.amount` (it splits alternatives on "or" only) and is NOT
 *  replaced here, because changing it would move an engine output this task promises not to move. `amount` below is
 *  its own, finer, read. Task 2 retires the difference. */
import type { ClauseRecord } from "../canonicalize.js";
import type {
  Ability, Characteristics, LandFetch, ManaAnyColour, ManaLine, ManaLineSource, StaticFixer, SubjectFilter,
} from "../schema.js";
import { isEnergyObject } from "./effect-kind.js";

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
const noCost = (): Cost => ({ mana: 0, tap: false, sacrificeSelf: false, sacrificeOther: false, life: 0, other: [] });

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
    out.other.push(piece);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// What a line makes
// ---------------------------------------------------------------------------------------------------------------

const SCALES = /\b(for each|equal to|that (?:many|much)|number of|where x)\b[^.]*|\{X\}|\bX\b/;

/** What `object` ("one mana of any color", "{U}{U}, {U}{R}, or {R}{R}", "five mana in any combination of colors")
 *  makes, alternative by alternative. */
function production(object: string): Pick<ManaLine, "colours" | "colourless" | "anyColour" | "amount"> {
  const text = object.trim();
  const lower = text.toLowerCase();
  const alts = text.split(/\s*,\s*or\s+|\s*,\s+|\s+or\s+/i).filter((a) => a.trim() !== "");
  const colours = new Set<string>();
  let colourless = 0;
  const counts: (number | undefined)[] = [];
  for (const alt of alts) {
    const symbols = [...alt.matchAll(/\{([WUBRGC](?:\/[WUBRGCP])?)\}/gi)].map((m) => m[1]!.toUpperCase());
    for (const s of symbols) for (const c of s.split("/")) if ((WUBRG as readonly string[]).includes(c)) colours.add(c);
    colourless = Math.max(colourless, symbols.filter((s) => s === "C").length);
    const word = new RegExp(`\\b(${WORD})\\s+mana\\b`, "i").exec(alt)?.[1]?.toLowerCase();
    counts.push(symbols.length > 0 ? symbols.length : word ? NUMBER_WORD[word] : /^(?:an? )?(?:additional )?mana\b/i.test(alt) ? 1 : undefined);
  }
  let anyColour: ManaAnyColour | null = null;
  if (/commander'?s color identity/.test(lower)) anyColour = "identity";
  else if (/\bthe chosen (?:color|type)\b|\bcolor of your choice\b/.test(lower)) anyColour = "chosen";
  else if (/\bcould produce\b/.test(lower)) anyColour = /\bopponents?\b/.test(lower) ? "opponent-lands" : /\b(?:lands?|gates?)\b/.test(lower) ? "lands-you-could" : null;
  else if (/\bany (?:one )?(?:color|type)\b|\bany combination of colou?rs\b|\bany colou?r\b/.test(lower)) anyColour = "any";
  if (anyColour === "any") for (const c of WUBRG) colours.add(c);
  const scale = SCALES.exec(text);
  const known = counts.length > 0 && counts.every((n) => n !== undefined);
  return {
    colours: inWubrgOrder(colours), colourless, anyColour,
    amount: scale ? { fixed: null, scales: scale[0].trim().toLowerCase() } : { fixed: known ? Math.min(...(counts as number[])) : null, scales: null },
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
    const spend = raw.replace(/,?\s+and (?:that|it|those)\b.*$/i, "").trim().toLowerCase();
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

const GATE = /\bactivate (?:this ability )?only (?:if|when|while) ([^.]*)/i;
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
};
const tokenKey = (sub: SubjectFilter["subtype"]): string | null => {
  const key = (Array.isArray(sub) ? sub.join("-") : sub ?? "").toLowerCase();
  if (key === "eldrazi-spawn" || key === "spawn-eldrazi") return "eldrazi-spawn";
  if (key === "eldrazi-scion" || key === "scion-eldrazi") return "eldrazi-scion";
  return key in MANA_TOKENS ? key : null;
};

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

  // --- add-mana lines, one per action, in clause order -------------------------------------------------------
  for (const clause of clauses) {
    // "one energy" / "an amount of {E} ..." is the clause layer reading an energy counter as mana (Roil Cartographer,
    // Aetherflux Conduit); `isEnergyObject` refuses the bare `{E}` and these two are the other spellings.
    const adds = (clause.actions ?? []).filter((a) => a.verb === "add-mana" && !isEnergyObject(a.object ?? "") && !/\{E\}|\benergy\b/i.test(a.object ?? ""));
    if (adds.length === 0) continue;
    const id = clause.id;
    const text = input.textOf(clause);
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
    for (const [k, action] of adds.entries()) {
      const source: ManaLineSource | null =
        tokenGrant ? "token-maker"
        : granted ? "static-grant"
        : activated ? "tap-ability"
        : clause.abilityType === "spell" ? "one-shot-spell"
        : clause.abilityType === "triggered"
          ? (trigger?.event === "tapped-for-mana" && /^(?:enchanted|equipped)\b/i.test(trigger.subject ?? "") ? "aura-trigger" : "trigger")
          // CEILING: a static ability that adds mana is printed by no card the corpus holds; refused, not guessed.
          : null;
      if (source === null) continue;
      const made = production(action.object ?? "");
      const ability = matching[k];
      const cost = source === "tap-ability" || source === "static-grant" || source === "token-maker"
        ? parseCost(costText, selfNames)
        : noCost();
      if (source === "one-shot-spell") cost.mana = faceMV(face);
      const produced = made.amount.fixed ?? 1;
      lines.push({
        face, source, repeats: ability?.repeats ?? null, cost, ...made,
        net: produced - cost.mana,
        gate: GATE.exec(text)?.[1]?.trim().toLowerCase() ?? null,
        restriction: restrictionOf(texts),
        timing: source === "trigger" || source === "aura-trigger" ? "on-trigger" : DELAYED.test(text) ? "next-turn" : "now",
        producesToken: tokenGrant ? "granted" : null,
      });
    }
  }

  // --- token makers and land fetches, from the derived abilities --------------------------------------------
  const seenClauses = new Set<string>();
  let fetchKind: LandFetch["kind"] | null = null;
  let fetchTapped = true;
  const reach = new Set<string>();
  for (const a of abilities) {
    const face = (a.face ?? 0) > 0 ? 1 : 0;
    if (a.effect.kind === "token-generation" && a.effect.subject?.control !== "opp") {
      const key = tokenKey(a.effect.subject?.subtype);
      if (key === null) continue;
      const dedupe = `token:${a.clause}:${key}`;
      if (seenClauses.has(dedupe)) continue;
      seenClauses.add(dedupe);
      const tokens = a.amount !== undefined && /^\d+$/.test(a.amount) ? Number(a.amount) : null;
      const cost = a.kind === "activated" ? parseCost(a.cost, selfNames) : noCost();
      if (a.kind === "on-cast") cost.mana = faceMV(face);
      const make = MANA_TOKENS[key]!;
      lines.push({
        face, source: "token-maker", repeats: a.repeats ?? null, cost, ...make,
        // Each token is one use of mana when it is spent; a token count that scales is unknown.
        amount: tokens !== null ? { fixed: tokens, scales: null } : { fixed: null, scales: a.amount ?? null },
        net: (tokens ?? 1) - cost.mana, gate: null, timing: "now", producesToken: key,
      });
      continue;
    }
    // A land SEARCHED out of the library onto the battlefield under your control: an `enters` emit (from the library, or with no origin
    // stated: the grammar path drops it) beside a land `search` in the same clause (the model path leaves the type off the emit; the search carries it). A
    // "look at the top N, put a land onto the battlefield" is a dig, not a fetch: no colour is promised.
    const search = abilities.find((x) => x.clause === a.clause && x.effect.kind === "search");
    for (const e of a.emits ?? []) {
      if (e.verb !== "enters" || (e.subject.fromZone !== undefined && e.subject.fromZone !== "library") || e.subject.control === "opp" || !search) continue;
      const found = search.effect.subject;
      if (!(e.subject.type === "land" || found?.type === "land" || found?.basic === true)) continue;
      const dedupe = `fetch:${a.clause}:${JSON.stringify(e.subject)}`;
      if (seenClauses.has(dedupe)) continue;
      seenClauses.add(dedupe);
      const lands = a.amount !== undefined && /^\d+$/.test(a.amount) ? Number(a.amount) : 1;
      const cost = a.kind === "activated" ? parseCost(a.cost, selfNames) : noCost();
      if (a.kind === "on-cast") cost.mana = faceMV(face);
      const colours = reachOf({ ...found, ...e.subject, subtype: e.subject.subtype ?? found?.subtype } as SubjectFilter);
      lines.push({
        face, source: "fetch", repeats: a.repeats ?? null, cost, colours, colourless: 0, anyColour: null,
        amount: { fixed: lands, scales: null }, net: lands - cost.mana, gate: null, restriction: null, timing: "now", producesToken: null,
      });
      fetchKind = a.kind === "on-cast" || fetchKind === "spell" ? "spell" : "permanent";
      fetchTapped = fetchTapped && e.subject.entersTapped === true;
      for (const c of colours) reach.add(c);
    }
  }

  // --- the card-level facts ----------------------------------------------------------------------------------
  const result: ManaResult = {};
  if (lines.length > 0) result.manaLines = lines;
  if (fetchKind !== null) result.landFetch = { kind: fetchKind, tapped: fetchTapped, reach: inWubrgOrder(reach) };

  // A one-shot: every line is spent in the using, an instant or sorcery's mana or a source that sacrifices itself.
  // The mana lines only: a fetch or a Treasure-maker beside them does not make the card repeatable.
  const manaOnly = lines.filter((l) => l.source !== "fetch" && l.source !== "token-maker");
  if (manaOnly.length > 0 && manaOnly.every((l) => l.source === "one-shot-spell" || (l.source === "tap-ability" && l.cost.sacrificeSelf))) result.isOneShot = true;

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
