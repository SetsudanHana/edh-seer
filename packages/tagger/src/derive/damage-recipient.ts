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

/** The recipient of a damage or life-loss action, when its words list a player beside something else (`anyOf`) or name a
 *  permanent's controller (untyped, `any`); undefined when neither, so the caller keeps the parsed noun. */
export function damageRecipient(object: string): SubjectFilter | undefined {
  let t = object.trim().toLowerCase();
  if (t === "") return undefined;
  if (isControllerPhrase(t)) return { control: "any", token: null };
  // "any target that isn't a Dragon" (Wrathful Red Dragon), "any other target": still any target, so a player can be hit.
  if (t.startsWith("any target ") || t.startsWith("any other target")) return { control: "any", token: null, scope: "target", ...(t.startsWith("any other") ? { other: true as const } : {}) };
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

/** The card ITSELF is the one hit (#1266, burn): the fight-back half of "Garruk deals 3 damage to target creature. That creature deals damage equal to its power to him" (the grammar writes the object `him`,
 *  `~` or `this`; Tahngarth, Polukranos), so it is no damage to a player or to any target. "Him" and "her" are the card only after the fight-back sentence; "~" is always the card's own name. */
const FIGHT_BACK = /\b(?:that creature|those creatures|each of those creatures|it) deals? damage equal to (?:its|their) power to (?:him|her)\b/i;
export function damageHitsSelf(object: string, clauseText: string): boolean {
  const o = object.trim().toLowerCase();
  return o === "~" || ((o === "him" || o === "her") && FIGHT_BACK.test(clauseText));
}

/** WHO DEALS THE DAMAGE when a CREATURE does, not the spell (#1266, burn): "Target creature you control deals damage equal to its power to target creature you don't control" (Rabid Bite),
 *  "... to each other creature and each opponent" (Chandra's Ignition), "that creature deals damage" . The emit's dealer is then a creature, `you` when the sentence says "you control".
 *  A sentence word scan, no backtracking: the text before the first " deals " must be exactly such a creature phrase. Undefined when the dealer is the card or unclear. */
export function creatureDamageSource(clauseText: string): "you" | "any" | undefined {
  const lower = clauseText.toLowerCase();
  const at = lower.indexOf(" deals ");
  if (at < 0) return undefined;
  // The head: the sentence part before " deals ", after any cost or earlier sentence.
  const head = lower.slice(0, at).split(/[.:]/).pop()!.trim();
  const phrases = ["target creature you control", "up to one target creature you control", "target creature", "that creature", "each of those creatures"];
  if (!phrases.includes(head)) return undefined;
  return head.endsWith("you control") ? "you" : "any";
}
