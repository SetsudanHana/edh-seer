/** WHO A DAMAGE OR LIFE-LOSS ACTION HITS, read off the words of its object (#1266, the burn role).
 *
 *  `parseSubject` reads ONE noun out of a phrase, so a recipient that lists a player beside a permanent kept
 *  only the permanent: "each opponent and each creature they control" (Wildfire Cerberus) was `creature, opp`,
 *  "target player or planeswalker" (Lava Spike) was `planeswalker` on the EMIT (the effect subject read it through
 *  the filter grammar), and "that creature's controller" (Banewasp Affliction) was the creature. A damage spell
 *  that cannot hit a player and one that can then read the same, which is what a burn role has to tell apart.
 *
 *  Two shapes are read here, nothing else:
 *   - a LIST with a player item and a non-player item -> `anyOf` [player branch, permanent branch], the shape
 *     the filter grammar already gives "each creature and each player" (Pestilence);
 *   - "X's controller" / "its owner" -> the PLAYER (untyped, `any`: whose it is depends on X), never X's type.
 *  Everything else returns undefined and keeps the reading it had.
 *
 *  Linear word scans only: no regex with a lazy or optional-whitespace tail (CodeQL js/polynomial-redos). */
import type { SubjectFilter } from "../schema.js";
import { parseSubject } from "./subject.js";
import { isSelfSubject } from "./self-reference.js";
import { SUBTYPE_TYPES } from "./subtypes.js";

/** Words that open an item without naming it ("each", "target", "up to one", "another"). */
const DETERMINERS: ReadonlySet<string> = new Set([
  "a", "an", "the", "each", "every", "all", "any", "another", "other", "target", "that", "those", "up", "to", "one", "two", "three", "x", "this", "no", "of",
]);
/** The words that open the FIRST item with a quantity or a pick ("target", "each", "up to one"); a later bare item inherits them. */
const QUANTIFIERS: ReadonlySet<string> = new Set(["target", "each", "all", "any", "another", "up", "to", "one", "two", "three", "x"]);
/** Words that open a relative clause or a condition: a fragment holding one is not a recipient phrase. */
const CLAUSE_WORDS: ReadonlySet<string> = new Set(["who", "whose", "named", "dealt", "has", "have", "had", "cast", "is", "are", "was", "than", "didn't", "doesn't", "didn't", "if", "when", "which", "poison", "counters", "counter"]);
const PLAYER_HEADS: ReadonlySet<string> = new Set(["player", "players", "opponent", "opponents"]);
/** CEILING: CONTROL_TAILS are matched as a SUFFIX of the whole object, so a tail in the middle ("each creature target player controls and each player") is not read. */
/** What the player-controls tail of a permanent item says about WHOSE permanents they are. */
const CONTROL_TAILS = ["they control", "that player controls", "that opponent controls", "defending player controls", "target player controls", "target opponent controls", "that player or that planeswalker's controller controls"];
/** A relative clause about the TARGET, not the type ("it has dealt damage to this game"): cut before parsing. */
const RELATIVE_CUTS = [" this creature has dealt damage to this game", " it has dealt damage to this game", " it's attacking", " that creature is attacking", " it is attacking"];

const words = (s: string): string[] => s.split(" ").filter((w) => w !== "");

/** "that creature's controller", "its owner", "that spell's controller", "the creature's owner": the player behind a permanent. */
export function isControllerPhrase(object: string): boolean {
  const t = object.trim().toLowerCase();
  if (t === "its controller" || t === "its owner" || t === "their controller") return true;
  const w = words(t);
  const last = w[w.length - 1];
  if ((last !== "controller" && last !== "owner") || w.length < 2) return false;
  // The word before must be possessive: "that creature's", "spell's", "permanents' ".
  const before = w[w.length - 2]!;
  return before.endsWith("'s") || before.endsWith("s'");
}

type Item = { text: string; kind: "player" | "other"; control?: "you" | "opp" };

/** One list item as a player or not, and which player.
 *  CEILING: only the first three words of an item are read for its player noun ("defending player", "target opponent"); a longer modifier run reads as not a player. */
function classify(text: string): Item {
  const w = words(text);
  if (isControllerPhrase(text)) return { text, kind: "player" };
  let i = 0;
  while (i < w.length && DETERMINERS.has(w[i]!)) i++;
  const rest = w.slice(i);
  const head = rest[0];
  // "defending player", "attacking player", "enchanted player", "that opponent player": the noun is the LAST of a short modifier run.
  if (head !== undefined && (head === "you" || head === "yourself") && rest.length === 1) return { text, kind: "player", control: "you" };
  const noun = rest.find((x, k) => PLAYER_HEADS.has(x) && k < 3 && rest.slice(0, k).every((m) => m === "defending" || m === "attacking" || m === "enchanted" || m === "opponent"));
  if (noun === undefined) return { text, kind: "other" };
  const opp = noun === "opponent" || noun === "opponents" || rest.includes("defending") || rest.includes("opponent");
  return { text, kind: "player", ...(opp ? { control: "opp" as const } : {}) };
}

/** CEILING: items are split on every comma, "and", "or" and "and/or" and a BARE later item takes the first item's quantifier ("target player or planeswalker"
 *  is a target planeswalker too). A list whose fragments are not all player, controller or typed-permanent phrases is refused wholesale (`damageRecipient`
 *  returns undefined), so a clause that merely holds an "or" keeps the old single-noun reading rather than a guessed branch.
 *  Split on ", ", " and/or ", " and ", " or " into items, dropping empty ones. */
function splitItems(text: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  const w = words(text);
  for (let i = 0; i < w.length; i++) {
    const x = w[i]!;
    if (x === "and" || x === "or" || x === "and/or") { if (cur.length) out.push(cur.join(" ")); cur = []; continue; }
    // A comma ends an item: "up to one target creature, up to one target player, and/or ...".
    if (x.endsWith(",")) { cur.push(x.slice(0, -1)); if (cur.length) out.push(cur.join(" ")); cur = []; continue; }
    cur.push(x);
  }
  if (cur.length) out.push(cur.join(" "));
  return out.filter((s) => s !== "");
}

/** Branch fields of a parsed item: everything the item states except the outer `token`. */
function branchOf(s: SubjectFilter): Partial<SubjectFilter> {
  const { token: _t, ...rest } = s;
  return rest;
}

const BARE_TARGET_WORDS: ReadonlySet<string> = new Set(["damage", "divided", "as", "you", "choose", "among", "any", "number", "of", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "x", "or", "each", "up", "to", "and"]);
/** An object that is only a count of targets, with no type: "any number of targets", "each of up to X targets", "3 damage divided as you choose among one, two, or three targets". */
function isBareTargets(t: string): boolean {
  const w = words(t.replace(/,/g, " "));
  if (w.length < 2 || w[w.length - 1] !== "targets") return false;
  return w.slice(0, -1).every((x) => BARE_TARGET_WORDS.has(x) || /^\d+$/.test(x));
}

/** The recipient of a damage or life-loss action, when its words list a player beside something else (`anyOf`) or name a
 *  permanent's controller (untyped, `any`); undefined when neither, so the caller keeps the parsed noun. */
export function damageRecipient(object: string): SubjectFilter | undefined {
  let t = object.trim().toLowerCase();
  if (t === "") return undefined;
  // A controller is a PLAYER, whose it is depends on X (#1465: "that land's controller", "its controller": Cryoclasm, Rakdos Charm).
  if (isControllerPhrase(t)) return { control: "any", token: null, player: true };
  // "any target that isn't a Dragon" (Wrathful Red Dragon), "any other target": still any target, so a player can be hit.
  if (t.startsWith("any target ") || t.startsWith("any other target")) return { control: "any", token: null, scope: "target", ...(t.startsWith("any other") ? { other: true as const } : {}) };
  // BARE TARGETS (#1465): "any number of targets" (Bogardan Hellkite, Rolling Thunder), "one or two targets" (Twin Bolt), "each of up to three targets" (Jaya's Immolating Inferno), "3 damage divided as you choose among one, two, or three
  // targets" (Inferno Titan) are targets (CR 115.1) of no stated type: any target, as the "any target" head above.
  if (isBareTargets(t)) return { control: "any", token: null, scope: "target" };
  for (const cut of RELATIVE_CUTS) { const at = t.indexOf(cut); if (at > 0) t = t.slice(0, at); }
  // The control tail binds the permanent items: "each creature they control" after "each opponent" is the opponent's.
  let tail = "";
  for (const c of CONTROL_TAILS) if (t.endsWith(` ${c}`)) { tail = c; t = t.slice(0, t.length - c.length - 1); break; }
  const parts = splitItems(t);
  if (parts.length < 2) return undefined;
  // A BARE ITEM TAKES THE FIRST ITEM'S QUANTIFIER, as the filter grammar reads it: "target player or planeswalker" is a target
  // planeswalker too, "each opponent and planeswalker" an each planeswalker.
  const leadWords: string[] = [];
  for (const w of words(parts[0]!)) { if (QUANTIFIERS.has(w)) leadWords.push(w); else break; }
  if (leadWords.length > 0) {
    for (let i = 1; i < parts.length; i++) {
      const first = words(parts[i]!)[0];
      if (first !== undefined && !DETERMINERS.has(first) && !isControllerPhrase(parts[i]!)) parts[i] = `${leadWords.join(" ")} ${parts[i]}`;
    }
  }
  const items = parts.map(classify);
  const players = items.filter((x) => x.kind === "player");
  if (players.length === 0 || players.length === items.length) return undefined;
  // REFUSE A LIST THAT IS NOT CLEAN. A relative clause or a name can hold an "or", an "and" or a comma ("each opponent who has three or more poison
  // counters", "a creature named Gollum, Obsessed Stalker", "target player who cast one or more sorcery spells"), and splitting there invents a branch.
  // Every fragment must be a player phrase, a controller phrase or a typed permanent phrase with none of the clause words; anything else keeps the old reading.
  for (const part of parts) {
    const pw = words(part);
    if (pw.some((x) => CLAUSE_WORDS.has(x))) return undefined;
    const it = classify(part);
    if (it.kind === "other") {
      const ps = parseSubject(part);
      const bareTarget = pw.every((x) => DETERMINERS.has(x) || x === "targets");
      if (ps.type === undefined && ps.subtype === undefined && !bareTarget) return undefined;
    }
  }
  const opponentTail = tail !== "" && players.some((p) => p.control === "opp");
  const branches: Partial<SubjectFilter>[] = [];
  for (const it of items) {
    if (it.kind === "player") {
      const s = parseSubject(it.text);
      // The player branch states the player and how it is picked, never a type (a controller phrase names no scope).
      const control = it.control ?? (s.control === "you" || s.control === "opp" ? s.control : undefined);
      branches.push({ player: true, ...(control !== undefined ? { control } : {}), ...(s.scope !== undefined && !isControllerPhrase(it.text) ? { scope: s.scope } : {}) });
    } else {
      const b = branchOf(parseSubject(it.text));
      if (opponentTail && b.control === "any") b.control = "opp";
      branches.push(b);
    }
  }
  return { control: "any", token: null, anyOf: branches };
}

/** DAMAGE THAT CAN ONLY HIT A PLAYER (#1294): "target player", "target opponent", "that player", "that opponent". `parseSubject` reads these as an untyped subject, byte for byte what it
 *  reads for "any target", so a role asking "can this damage reach a permanent?" could not tell Pyroclastic Elemental from Lightning Bolt. The player subject states the player, as the
 *  "player or planeswalker" branch of `damageRecipient` does. "Any target" stays untyped. Exact phrases only: a longer phrase ("target player who controls ...") keeps its reading. */
const PLAYER_ONLY_OBJECTS: ReadonlySet<string> = new Set([
  "target player", "target opponent", "that player", "that opponent",
  // #1465: a recipient that names only a player, left untyped and so read as "could be a creature" (Price of Progress, Browbeat, Curse of Shaken Faith, Khorvath's Fury)
  "each player", "any player", "the player", "each other player", "each opponent", "each foe", "enchanted player", "the chosen player", "each other opponent", "defending player", "any opponent", "each of your opponents", "chosen opponent", "an opponent",
]);
/** What may follow the noun without changing who is hit: a qualifier on the same player ("target player who attacked this turn", "target opponent chosen at random", "target opponent previously dealt damage by it"). */
const PLAYER_QUALIFIERS: ReadonlySet<string> = new Set(["who", "whose", "chosen", "previously", "at"]);
export function playerOnlyRecipient(object: string): SubjectFilter | undefined {
  const t = object.trim().toLowerCase();
  const w = words(t);
  const n = PLAYER_ONLY_OBJECTS.has(w.slice(0, 3).join(" ")) ? 3 : PLAYER_ONLY_OBJECTS.has(w.slice(0, 2).join(" ")) ? 2 : PLAYER_ONLY_OBJECTS.has(w[0] ?? "") ? 1 : 0;
  if (n === 0 || (w.length > n && !PLAYER_QUALIFIERS.has(w[n]!))) return undefined;
  // A player has no type: a qualifier clause ("who cast one or more sorcery spells") must not leak one onto it (Backdraft read `sorcery`).
  const { type: _ty, subtype: _st, ...s } = parseSubject(t);
  return { ...s, player: true };
}

/** The card ITSELF is the one hit (#1266, burn): the fight-back half of "Garruk deals 3 damage to target creature. That creature deals damage equal to its power to him" (the grammar writes the object `him`,
 *  `~` or `this`; Tahngarth, Polukranos), so it is no damage to a player or to any target. "Him" and "her" are the card only after the fight-back sentence; "~" is always the card's own name. */
const FIGHT_BACK = /\b(?:that creature|those creatures|each of those creatures|it) deals? damage equal to (?:its|their) power to (?:him|her)\b/i;
export function damageHitsSelf(object: string, clauseText: string): boolean {
  const o = object.trim().toLowerCase();
  return o === "~" || ((o === "him" || o === "her") && FIGHT_BACK.test(clauseText));
}

/** WHO DEALS THE DAMAGE, read off the damage sentence's PRINTED SUBJECT (#1266 burn, #1462): the words before " deals ". Three answers.
 *   - `self`: the card itself ("this creature / this artifact / ... / this spell", its own name or short name, `~`; "it" when the clause's trigger is about the card -- Murderous Redcap).
 *   - `other`: another object, typed from the phrase by `parseSubject` ("target creature you control", "that creature", "each creature", "enchanted creature", "target land", "the exiled creature"): control
 *     (`you` / `opp`, else `any`), type or subtype. A typed dealer is never the card, so a matcher asking "a red source you control" cannot read it as the card's colour.
 *   - undefined: unclear (an "it" with another antecedent, "he", "that source", a head that names no type) -- the dealer stays bare, which the matcher reads as the card unless a heuristic refuses it.
 *  `nth` is which of the clause's `count` deal-damage actions this is: the k-th " deals " of the text, when the text holds exactly `count` of them (Stalking Yeti: "it deals ... and that creature deals ...").
 *  A clause whose count differs stays unread. The head is the words after the last clause break; a trigger's own " deals " ("Whenever this creature deals damage") is not an action's.
 *  Linear scans only: no regex with a lazy or unbounded tail over card text (CodeQL js/polynomial-redos). */
export type DamageDealer = { self: true } | { other: Pick<SubjectFilter, "control" | "token" | "type" | "allTypes" | "subtype"> };
const SELF_NOUNS: ReadonlySet<string> = new Set(["creature", "artifact", "enchantment", "permanent", "spell", "land", "aura", "equipment", "vehicle", "planeswalker", "saga", "class", "siege", "room", "card", "contraption"]);
const OTHER_OPENERS: ReadonlySet<string> = new Set(["target", "that", "those", "each", "enchanted", "equipped", "fortified", "the", "all", "another", "up"]);
const BREAKS = [". ", ": ", "; ", ", ", " then ", " and ", " — ", " instead ", " if ", "\n"];
function lastBreak(s: string): string {
  let best = -1, len = 0;
  for (const b of BREAKS) { const at = s.lastIndexOf(b); if (at >= 0 && at + b.length > best + len) { best = at; len = b.length; } }
  return best < 0 ? s : s.slice(best + len);
}
/** The positions of the damage verbs: " deals ", and " deal " after "have" ("you may have that creature deal 1 damage": Rage Forger) or "they (each)" ("They each deal damage equal to their power": Coordinated Clobbering). */
function dealAt(lower: string): { at: number; len: number }[] {
  const out: { at: number; len: number }[] = [];
  for (let at = lower.indexOf(" deals "); at >= 0; at = lower.indexOf(" deals ", at + 7)) out.push({ at, len: 7 });
  for (let at = lower.indexOf(" deal "); at >= 0; at = lower.indexOf(" deal ", at + 6)) {
    const head = lastBreak(lower.slice(0, at)).trim();
    if (head.startsWith("have ") || head.startsWith("you may have ") || head.startsWith("may have ") || head === "they each" || head === "they" || head.endsWith(" each")) out.push({ at, len: 6 });
  }
  return out.sort((x, y) => x.at - y.at);
}
/** The subject of the trigger that opens the clause, read off the PRINTED words ("Whenever a Beast you control enters, ..." -> "a beast you control"). The text and not `clause.trigger.subject`, so the grammar's
 *  reading and the stored model answer (which words "becomes blocked by a creature" as subject "a creature") derive the same dealer and the card-by-card switch has nothing to flip over (#1462). */
const TRIGGER_VERBS: ReadonlySet<string> = new Set(["enters", "enter", "attacks", "attack", "blocks", "block", "dies", "die", "deals", "deal", "is", "are", "becomes", "become", "leaves", "leave", "gets", "get", "taps", "untaps", "cast", "casts", "controls", "draws", "gains", "loses", "sacrifices", "would", "has", "have", "dealt"]);
function triggerSubject(lower: string): string | undefined {
  const start = lower.startsWith("whenever ") ? 9 : lower.startsWith("when ") ? 5 : -1;
  if (start < 0) return undefined;
  const end = lower.indexOf(", ");
  if (end < 0) return undefined;
  const words = lower.slice(start, end).split(" ");
  if (words[0] === "you" || (words[0] === "an" && words[1] === "opponent")) return "";
  const k = words.findIndex((w) => TRIGGER_VERBS.has(w));
  return (k < 0 ? words : words.slice(0, k)).join(" ").trim();
}
const PERMANENT_TYPES: ReadonlySet<string> = new Set(["creature", "artifact", "enchantment", "land", "planeswalker", "battle", "permanent"]);
/** "it" stands for the trigger's subject: the card (self) or a typed permanent. A spell, a player or a counter is not a dealer this scan can name. */
function triggerDealer(subject: string | undefined, cardName: string | undefined): DamageDealer | undefined {
  if (subject === undefined || subject === "" || subject.includes(" or ")) return undefined;
  const w = subject.split(" ");
  if (subject === "~" || (w[0] === "this" && w.length === 2 && SELF_NOUNS.has(w[1]!)) || isSelfSubject(subject, cardName)) return { self: true };
  const d = typedDealer(subject);
  if (d === undefined || !("other" in d)) return undefined;
  const t = ([] as string[]).concat(d.other.type ?? []);
  return t.length > 0 && !t.every((x) => PERMANENT_TYPES.has(x)) ? undefined : d;
}
export function damageDealerOf(clauseText: string, nth: number, count: number, cardName: string | undefined): DamageDealer | undefined {
  // The card's own full name is one word for the scan ("Vikya, Scorching Stalwart deals" has a comma in it): replaced by `~`, longest face first.
  let lower = clauseText.toLowerCase();
  for (const face of (cardName ?? "").toLowerCase().split(" // ").map((f) => f.trim()).filter((f) => f.length > 0).sort((a, b) => b.length - a.length)) lower = lower.split(face).join("~");
  const heads: { head: string; at: number }[] = [];
  for (const { at } of dealAt(lower)) {
    let head = lastBreak(lower.slice(0, at)).trim();
    while (head.startsWith("•") || head.startsWith('"')) head = head.slice(1).trim();
    for (const lead of ["you may have ", "may have ", "have "]) if (head.startsWith(lead)) { head = head.slice(lead.length).trim(); break; }
    // "Up to two target creatures you control each deal damage equal to their power": the dealers are the creatures named, `each` only spreads the verb.
    if (head.endsWith(" each") && head !== "they each") head = head.slice(0, -5).trim();
    const w = head.split(" ")[0] ?? "";
    // A trigger's or a condition's own dealer ("whenever a creature you control deals damage", "if a source would deal"), a reminder, or a granted quote is not an action's.
    if (w === "when" || w === "whenever" || w === "if" || w === "unless" || w === "as" || w.startsWith("(")) continue;
    heads.push({ head, at });
  }
  // One printed dealer for several damage actions ("Target creature you control deals damage equal to its power to ... If it has trample, excess damage is dealt to ...": Ram Through) is the dealer of all of them.
  if (heads.length === 1 && count > 1 && nth < count) heads.push(...Array.from({ length: count - 1 }, () => heads[0]!));
  if (heads.length !== count || nth >= count) return undefined;
  const resolve = (i: number): DamageDealer | undefined => {
    let head = heads[i]!.head;
    for (const lead of ["then ", "instead ", "also "]) if (head.startsWith(lead)) head = head.slice(lead.length).trim();
    if (head.endsWith(" also")) head = head.slice(0, -5).trim();
    if (head === "") return undefined;
    const parts = head.split(" ");
    if (head === "~") return { self: true };
    if (head === "it" || head === "they each" || head === "they") {
      // "~ deals X damage to target creature. If it was kicked, it deals X damage to that creature's controller" (Illuminate): a later "it" is the dealer just named.
      if (i > 0 && head === "it" && heads[i - 1]!.at !== heads[i]!.at) return resolve(i - 1);
      const found = antecedentOf(lower.slice(0, heads[i]!.at));
      if (found !== undefined) return found === "none" ? undefined : found;
      return triggerDealer(triggerSubject(lower), cardName);
    }
    if (parts[0] === "this") return parts.length === 2 && SELF_NOUNS.has(parts[1]!) ? { self: true } : undefined;
    if (isSelfSubject(head, cardName)) return { self: true };
    if (head === "that creature" || head === "those creatures" || head === "each of those creatures") {
      // A back-reference takes its antecedent's control: Stalking Yeti's "that creature" is the "target creature an opponent controls", Halana's the creature you control that entered. Unresolvable -> `any`.
      const before = lower.slice(0, heads[i]!.at - head.length - 1);
      const found = antecedentOf(before, true);
      const via = found !== undefined && found !== "none" ? found : triggerDealer(triggerSubject(lower), cardName);
      if (via !== undefined && "other" in via) return via;
    }
    return OTHER_OPENERS.has(parts[0]!) ? typedDealer(head) : undefined;
  };
  return resolve(nth);
}
function typedDealer(phrase: string): DamageDealer | undefined {
  const s = parseSubject(phrase);
  if (s.type === undefined && s.subtype === undefined) return undefined;
  // A tribal dealer ("another Elemental you control") names a subtype only; a consumer asking for an instant or sorcery source must not meet it, so the subtype's card types (CR 205.3) fill the type.
  let type = s.type;
  if (type === undefined) {
    const from = ([] as string[]).concat(s.subtype ?? []).flatMap((st) => SUBTYPE_TYPES[st.toLowerCase()] ?? []);
    const uniq = [...new Set(from)];
    if (uniq.length > 0) type = uniq.length === 1 ? uniq[0]! : uniq;
  }
  return { other: { control: s.control, token: s.token, ...(type !== undefined ? { type } : {}), ...(s.allTypes !== undefined ? { allTypes: s.allTypes } : {}), ...(s.subtype !== undefined ? { subtype: s.subtype } : {}) } };
}

/** What a pronoun stands for, read off the clause text before it: the NEAREST object named after the trigger -- "this creature" (the card: a cost "Sacrifice this creature: It deals"), "target creature you control"
 *  ("Target creature you control gets +1/+0 until end of turn. It deals"), "that creature", "enchanted creature". Undefined when none is named (the trigger's subject then stands, in `damageDealerOf`);
 *  "none" when the first is named but types nothing (a player), so the dealer stays unclear. */
const PHRASE_ENDS = [" gets ", " get ", " gains ", " gain ", " has ", " have ", " and ", " to ", " deals ", " deal ", " that ", " with ", " becomes ", " can't ", " fights ", " fight ", " is ", " are ", " each ", " then ", " until ", " as ", " of ", " on ", " attacks", " blocks"];
function antecedentOf(before: string, skipRef = false): DamageDealer | "none" | undefined {
  let text = before;
  const opener = text.split(" ")[0] ?? "";
  if (opener === "when" || opener === "whenever" || opener === "at") { const c = text.indexOf(", "); text = c < 0 ? "" : text.slice(c + 2); }
  const pick: { at: number; kind: "self" | "target" | "ref" } = { at: -1, kind: "ref" };
  const consider = (at: number, k: "self" | "target" | "ref") => { if (at >= 0 && at > pick.at) { pick.at = at; pick.kind = k; } };
  for (const noun of SELF_NOUNS) consider(text.lastIndexOf(`this ${noun}`), "self");
  consider(text.lastIndexOf("~"), "self");
  // "becomes the target of a spell, it deals" names no object ("target of").
  for (let at = text.lastIndexOf("target "); at >= 0; at = at === 0 ? -1 : text.lastIndexOf("target ", at - 1)) if (!text.startsWith("target of ", at)) { consider(at, "target"); break; }
  for (const r of skipRef ? [] : ["that creature", "enchanted creature", "equipped creature"]) consider(text.lastIndexOf(r), "ref");
  if (pick.at < 0) return undefined;
  if (pick.kind === "self") return { self: true };
  let rest = text.slice(pick.at);
  let end = rest.length;
  for (const e of [...PHRASE_ENDS, ". ", ", ", ": ", "; "]) { const at = rest.indexOf(e, 1); if (at >= 0 && at < end) end = at; }
  rest = rest.slice(0, end).trim();
  return typedDealer(rest) ?? "none";
}

/** A GRANTED "this creature deals" is the creature the grant lands on (#1462): "Enchanted creature has \"{T}: This creature deals 1 damage ...\"", "Creatures you control have ...", "Equipped creature gains ...".
 *  Read from the granting clause's own words before its first has / have / gains / gain; undefined when that subject names no creature (a land or an unknown grantee stays a bare dealer). */
export function granteeDealer(grantClauseText: string): { control: SubjectFilter["control"]; token: null; type: string | string[]; subtype?: string | string[] } | undefined {
  const lower = grantClauseText.toLowerCase();
  let end = -1;
  for (const v of [" has ", " have ", " gains ", " gain "]) { const at = lower.indexOf(v); if (at >= 0 && (end < 0 || at < end)) end = at; }
  if (end < 0) return undefined;
  // The grantee is the last comma-clause before the verb: "When this creature enters, target artifact you control gains" is the artifact, "..., until end of turn, Spirit creatures you control gain" the Spirits.
  // Only LEADING trigger / duration clauses are dropped, so a list grantee ("Assassins, Mercenaries, and Rogues you control have") keeps its commas.
  let subject = lower.slice(0, end).trim();
  for (let lead = /^(?:[^,]*— )?(?:when|whenever|at|until|if|as|during|after|for each|once)\b/; lead.test(subject);) {
    const c = subject.indexOf(", ");
    if (c < 0) break;
    subject = subject.slice(c + 2);
  }
  const d = typedDealer(subject);
  if (d === undefined || !("other" in d) || d.other.type === undefined) return undefined;
  const types = ([] as string[]).concat(d.other.type);
  if (!types.includes("creature")) return undefined;
  // The grantee's class travels with the dealer: "All Slivers have" is a Sliver, "Spirit creatures you control gain" a Spirit you control, so a consumer watching a non-Sliver creature's damage does not meet it.
  return { control: d.other.control, token: null, type: d.other.type, ...(d.other.subtype !== undefined ? { subtype: d.other.subtype } : {}) };
}
