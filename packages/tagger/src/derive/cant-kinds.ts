/** THE THREE `cant` LINES #1401 part 5 STOPPED READING AS ABILITY-LOSS, EACH WITH A KIND OF ITS OWN (#1423, owner ruling 2026-10-30): `targeting-ban`, `trigger-suppression`, `untap-denial`.
 *  Pure readers over a stored action's object and the printed clause; `effect-kind.ts` asks "is it one" and `derive.ts` copies the fields onto the ability. Every reader is a WHITELIST: a word it does not
 *  know refuses the whole line (a missing answer beats a silent wrong one), and none of them backtracks on card text (words are split on a single space, never matched with a leading `.*`). */
import type { Control, SubjectFilter } from "../schema.js";

/** The words of a phrase, lowercased, commas dropped (a list is read by its words). Empty for a blank phrase. */
function words(text: string): string[] {
  return text.toLowerCase().replace(/[,.]/g, " ").split(" ").filter((w) => w !== "");
}

/** The sentence of `text` holding index `at`: from the previous ". " to the next one. */
function sentenceAround(text: string, at: number): { head: string; tail: string } {
  const from = text.lastIndexOf(". ", at);
  const start = from < 0 ? 0 : from + 2;
  const to = text.indexOf(". ", at);
  return { head: text.slice(start, at), tail: text.slice(at, to < 0 ? text.length : to + 1) };
}

/** Where the sentence holding index `at` starts. */
function sentenceStart(text: string, at: number): number {
  const i = text.lastIndexOf(". ", at);
  return i < 0 ? 0 : i + 2;
}

/** The `n`-th (clamped) start index of a global regex's match in `text`, or -1 when there is none. */
function nthMatch(text: string, re: RegExp, n: number): RegExpExecArray | undefined {
  const hits = [...text.matchAll(re)];
  return hits[Math.min(n, hits.length - 1)];
}

const COLOUR_LETTER: Readonly<Record<string, string>> = { white: "W", blue: "U", black: "B", red: "R", green: "G" };
const SOURCE_TYPES: ReadonlySet<string> = new Set(["artifact", "creature", "enchantment", "land", "planeswalker", "instant", "sorcery", "battle"]);

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// 1. TARGETING-BAN
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** WHAT CAN'T TARGET IT, AND WHOSE (#1423). `by`: a spell, an ability, or both ("spells or abilities"); "activated abilities" (Peace Talks) is `activated-ability`. `source` is the filter on the
 *  spell or ability's SOURCE: `control` `opp` for "your opponents control", else `any`; `colors` / `notColors` (WUBRG letters) for "blue spells or abilities from blue sources" and "nongreen ...";
 *  `type` for "abilities from artifact sources"; `subtype` for "Aura spells". Hexproof (CR 702.11) is exactly `{by: [spell, ability], source: {control: opp}}`, shroud (CR 702.18) the same with
 *  `control: any`. */
export interface TargetingBan {
  by: ("spell" | "ability" | "activated-ability")[];
  source: SubjectFilter;
}

const TARGET_OF = /\bbe the targets? of\b/i;
const CANT_SUFFIXES = ["can't", "can’t", "cannot"];
/** Words a targeting-ban tail may hold. Anything else ("that", "only", "unless", "if", "named", "with", a number) is a narrowing this kind cannot hold, and refuses the line. */
const TAIL_GLUE: ReadonlySet<string> = new Set(["or", "and", "of", "from", "the"]);

/** The spell/ability words of a tail, adjective by adjective. Returns undefined for any word it does not know. */
function parseTargetingTail(tail: string): TargetingBan | undefined {
  const ws = words(tail);
  let spell: string[] | undefined, ability: string[] | undefined, activated = false;
  /** The adjectives read since the last noun (before "spells"), or since "from" (before "sources", for an ability). */
  let pending: string[] = [];
  let control = 0, lastWasControl = false;
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i]!;
    const wasControl: boolean = lastWasControl;
    lastWasControl = false;
    if (w === "spells" || w === "spell") { if (spell) return undefined; spell = pending; pending = []; continue; }
    if (w === "abilities" || w === "ability") {
      if (ability) return undefined;
      activated = ws[i - 1] === "activated";
      ability = []; // the qualifier of an ability comes after it: "abilities from artifact sources"
      continue;
    }
    if (w === "your" && ws[i + 1] === "opponents" && ws[i + 2] === "control") { control++; i += 2; lastWasControl = true; continue; }
    if (w === "activated") continue;
    if (w === "sources" || w === "source") { if (!ability || pending.length === 0) return undefined; ability = pending; pending = []; continue; }
    if (w === "this") { if (ws[i + 1] !== "turn") return undefined; i++; lastWasControl = wasControl; continue; }
    if (TAIL_GLUE.has(w)) continue;
    if (w in COLOUR_LETTER || (w.startsWith("non") && w.slice(3) in COLOUR_LETTER) || SOURCE_TYPES.has(w) || w === "aura") { pending.push(w); continue; }
    return undefined;
  }
  if (pending.length > 0 || (!spell && !ability)) return undefined;
  const nouns = (spell ? 1 : 0) + (ability ? 1 : 0);
  // WHOSE: "your opponents control" once, at the very end (it covers every noun before it), or once per noun (Thrun).
  if (control > 0 && !(control === nouns || (control === 1 && lastWasControl))) return undefined;
  // Where both nouns carry a qualifier it must be the same one; a qualifier on only one of two is a ban this filter cannot hold.
  const key = (g: string[]) => [...new Set(g)].sort().join("|");
  if (spell && ability && key(spell) !== key(ability)) return undefined;
  const adj = spell ?? ability ?? [];
  const source: SubjectFilter = { control: control > 0 ? "opp" : "any", token: null };
  const colors = adj.filter((a) => a in COLOUR_LETTER).map((a) => COLOUR_LETTER[a]!);
  const notColors = adj.filter((a) => a.startsWith("non") && a.slice(3) in COLOUR_LETTER).map((a) => COLOUR_LETTER[a.slice(3)]!);
  if (colors.length > 0) source.colors = [...new Set(colors)];
  if (notColors.length > 0) source.notColors = [...new Set(notColors)];
  const types = [...new Set(adj.filter((a) => SOURCE_TYPES.has(a)))];
  if (types.length > 0) source.type = types.length === 1 ? types[0]! : types;
  if (adj.includes("aura")) source.subtype = ["aura"];
  const by: TargetingBan["by"] = [...(spell ? ["spell" as const] : []), ...(ability ? [activated ? "activated-ability" as const : "ability" as const] : [])];
  return { by, source };
}

/** A SCOPED "can't be the target of ..." (CR 115.1 targets; CR 702.11 hexproof and CR 702.18 shroud are the keyword forms of the same restriction), read off the action's object
 *  ("be the target of spells or abilities your opponents control", or with its subject kept: "players can't be the targets of spells or activated abilities"). `clauseText`, where known,
 *  must print "can't|cannot be the target(s) of" and must not hold a CONDITION on the sentence ("As long as ..., this creature can't be the target ..."). Refused: a narrowed spell or ability
 *  ("spells that can target only Walls": Wall of Shadows), a condition ("... unless it attacked or blocked this turn": Lurker), and anything that is not a ban (Kaya, Bane of the Dead's
 *  "can be the targets of spells and abilities you control as though they didn't have hexproof" is the opposite permission).
 *  CEILING: only the whitelisted words of a tail are read (spells, abilities, activated, a colour or non-colour, a card type, Aura, "your opponents control", "from ... sources", "this turn");
 *  a qualifier on only one of "spells" and "abilities" that is not repeated refuses, and a ward-like cost ("unless its controller pays") is not a ban. */
/** A STATIC PROHIBITION ON THE CARDS IN GRAVEYARDS (#1266): "creature cards in graveyards (and libraries) can't enter the battlefield", "players can't cast / play ... from graveyards", "... or activate abilities of cards in
 *  graveyards". Read off the stored object and the printed clause together, because the grammar and the model each keep a different slice of the sentence. NOT "cards in graveyards can't be the targets of ..." (protection, `targetingBanOf`),
 *  NOT a ban on casting from YOUR graveyard, NOT a threshold on attacking or blocking. CEILING: "from their graveyards" (Shaman's Trance, a spell: once) reads as a lock too; the `repeats` of its on-cast ability says once. */
const GRAVEYARD_ENTER_LOCK = /\b(?:cards?|permanents?) in (?:all |a )?graveyards?\b[^.]{0,40}?\benter the battlefield\b/i;
const GRAVEYARD_CAST_LOCK = /\b(?:cast|play)\b[^.]{0,60}?\bfrom (?:their |all |a )?graveyards?\b/i;
const GRAVEYARD_ACTIVATE_LOCK = /\bactivate abilities of cards in (?:all |a )?graveyards?\b/i;
export function graveyardLockOf(object: string, clauseText = ""): boolean {
  if (clauseText !== "" && !/\b(?:can['\u2019]t|cannot)\b/i.test(clauseText)) return false;
  const text = `${object}. ${clauseText}`;
  return GRAVEYARD_ENTER_LOCK.test(text) || GRAVEYARD_CAST_LOCK.test(text) || GRAVEYARD_ACTIVATE_LOCK.test(text);
}

export function targetingBanOf(object: string, clauseText = "", occurrence = 0): TargetingBan | undefined {
  const at = object.search(TARGET_OF);
  if (at < 0) return undefined;
  const tail = object.slice(at).replace(TARGET_OF, "");
  if (clauseText !== "") {
    const hit = nthMatch(clauseText, /\b(?:can['’]t|cannot) be the targets? of\b/gi, occurrence);
    if (!hit) return undefined;
    const { head } = sentenceAround(clauseText, hit.index);
    if (/\b(?:as long as|if|while|unless)\b/i.test(head)) return undefined;
  }
  return parseTargetingTail(tail);
}

/** The words that name WHO can't be targeted: the object's own subject ("players can't be the targets of ...") when it kept one, else undefined (the caller reads the clause). */
export function targetingBanSubjectInObject(object: string): string | undefined {
  const at = object.search(TARGET_OF);
  let head = object.slice(0, at < 0 ? 0 : at).trim();
  if (head === "") return undefined;
  const lower = head.toLowerCase();
  for (const s of CANT_SUFFIXES) if (lower.endsWith(` ${s}`)) { head = head.slice(0, head.length - s.length - 1).trim(); break; }
  return head === "" ? undefined : head;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// 2. TRIGGER-SUPPRESSION
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** WHICH EVENTS STOP CAUSING TRIGGERS, AND WHOSE ABILITIES (#1423): Torpor Orb ("Creatures entering don't cause abilities to trigger") is `{events: ["enters"], controller: "any"}`, Hushbringer adds `dies`,
 *  Elesh Norn, Mother of Machines ("... of permanents your opponents control") is `controller: "opp"`. The things whose event is muted are `effect.subject` (creatures; artifacts and creatures; permanents).
 *  `any`: no event is named ("Triggered abilities of permanents your opponents control can't trigger"); none is printed on a card today, the CR can express it (CR 603.2). */
export interface TriggerSuppression {
  events: ("enters" | "dies" | "attacks" | "leaves" | "any")[];
  controller: Control;
}

const NEGATIONS = ["don't", "do not", "doesn't", "does not", "can't", "cannot"];
const EVENT_WORD: Readonly<Record<string, "enters" | "dies" | "attacks" | "leaves">> = { entering: "enters", dying: "dies", attacking: "attacks", leaving: "leaves" };
const MUTED_TYPES: ReadonlySet<string> = new Set(["creature", "creatures", "artifact", "artifacts", "land", "lands", "permanent", "permanents", "enchantment", "enchantments", "planeswalker", "planeswalkers"]);
const WHOSE_ABILITIES: Readonly<Record<string, Control>> = { "": "any", "of permanents your opponents control": "opp", "of permanents you control": "you" };

/** `head` without a trailing negation, or undefined when it ends in none. */
function withoutNegation(head: string): string | undefined {
  for (const n of NEGATIONS) if (head === n || head.endsWith(` ${n}`)) return head.slice(0, head.length - n.length).trim();
  return undefined;
}

/** "creatures entering or dying" -> events + the muted class' words; undefined for any word outside the whitelist. */
function parseMutedEvents(head: string): { events: TriggerSuppression["events"]; who: string } | undefined {
  const ws = words(head);
  const at = ws.findIndex((w) => w in EVENT_WORD);
  if (at <= 0) return undefined;
  let who = ws.slice(0, at);
  // "creatures opponents control entering", "... you control entering": whose entering is muted.
  const tail3 = who.slice(-3).join(" "), tail2 = who.slice(-2).join(" ");
  const control = tail3 === "your opponents control" ? 3 : tail2 === "opponents control" || tail2 === "you control" ? 2 : 0;
  const controlWords = who.slice(who.length - control);
  who = who.slice(0, who.length - control);
  if (who.length === 0 || !who.every((w) => MUTED_TYPES.has(w) || w === "and" || w === "or")) return undefined;
  const events: TriggerSuppression["events"] = [];
  for (const w of ws.slice(at)) {
    if (w in EVENT_WORD) { events.push(EVENT_WORD[w]!); continue; }
    if (w === "or" || w === "and" || w === "the" || w === "battlefield") continue;
    return undefined;
  }
  return { events: [...new Set(events)], who: [...who, ...controlWords].join(" ") };
}

/** "<things> entering [or dying] don't cause abilities [of permanents your opponents control] to trigger" and "triggered abilities [of ...] can't trigger" (CR 603.2: an ability triggers when its
 *  event happens; CR 603.6a, 603.6c: enters and leaves/dies). The stored action is a `cant` whose object is garbled (Torpor Orb: "creatures entering from causing abilities to trigger"; Hushbringer:
 *  "cause abilities to trigger"), so the PRINTED sentence is read; with no clause text the object is read and the verb is the negation. WHITELIST: the ability class must be plain "abilities"
 *  (Azorius Traffic Enforcement's "backup abilities", Nowhere to Run's "ward abilities" refuse), nothing may follow "to trigger", and any other word in the head (a condition: "As long as ...") refuses.
 *  "trigger an additional time" is the doubling (`trigger-doubling`), never this.
 *  Returns the muted class' words as `who` for the caller's subject filter. */
export function triggerSuppressionOf(object: string, clauseText = "", occurrence = 0): { suppression: TriggerSuppression; who: string } | undefined {
  const implied = clauseText === "";
  const lower = (implied ? object : clauseText).toLowerCase().replace(/\u2019/g, "'").replace(" from causing abilities", " cause abilities");
  // ---- "<things> entering don't cause abilities to trigger" ----
  const marks: number[] = [];
  for (let from = lower.indexOf(" cause abilities"); from >= 0; from = lower.indexOf(" cause abilities", from + 1)) marks.push(from);
  const at = marks[Math.min(occurrence, marks.length - 1)];
  if (at !== undefined) {
    const start = sentenceStart(lower, at);
    const stop = lower.indexOf(". ", at);
    const headRaw = lower.slice(start, at).trim();
    const head = implied ? headRaw : withoutNegation(headRaw);
    if (head === undefined) return undefined;
    const rest = lower.slice(at + " cause abilities".length, stop < 0 ? lower.length : stop).trim().replace(/\.$/, "");
    const whose = rest.endsWith(" to trigger") || rest === "to trigger" ? WHOSE_ABILITIES[rest.slice(0, rest.length - "to trigger".length).trim()] : undefined;
    if (whose === undefined) return undefined;
    const muted = parseMutedEvents(head);
    return muted ? { suppression: { events: muted.events, controller: whose }, who: muted.who } : undefined;
  }
  // ---- "triggered abilities [of permanents your opponents control] can't trigger" ----
  let verbAt = -1;
  if (implied) verbAt = lower.endsWith(" trigger") ? lower.length - " trigger".length : -1;
  else for (const n of NEGATIONS) { const i = lower.indexOf(` ${n} trigger`); if (i >= 0 && (lower.length === i + n.length + 9 || lower.startsWith(".", i + n.length + 9) )) { verbAt = i + 1 + n.length; break; } }
  if (verbAt < 0) return undefined;
  let head = lower.slice(sentenceStart(lower, verbAt), verbAt).trim();
  if (!implied) { const bare = withoutNegation(head); if (bare === undefined) return undefined; head = bare; }
  for (const lead of ["triggered abilities", "abilities"]) {
    if (!head.startsWith(lead)) continue;
    const whose = WHOSE_ABILITIES[head.slice(lead.length).trim()];
    if (whose !== undefined) return { suppression: { events: ["any"], controller: whose }, who: "" };
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// 2b. PLAYER-LOCK
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** A LASTING PROHIBITION OR LIMIT ON PLAYERS (#1266, owner ruling 2026-11-14; CR 101.2): "Players can't cast more than one spell each turn" (Rule of Law), "Your opponents can't cast spells with the chosen name"
 *  (Alhammarret), "Your opponents can't cast spells during your turn" (Kutzil, Grand Abolisher: `yourTurn`), "Your opponents can't gain life" (Erebos), "can't search libraries" (Stranglehold), "Players can't untap more than one
 *  land during their untap steps" (Winter Orb). Read off the PRINTED clause, because the model keeps neither the subject nor "during your turn" in the stored `cant` object; the object only says WHICH sentence of the clause
 *  this action is (its verb must be one the sentence's predicate holds: Void Winnower's "block with ..." is no lock). A WHITELIST: the subject is players, each player, (your) opponents, each opponent, other players or an
 *  enchanted player (or "that player" / "target opponent" beside a printed "for as long as" or "for the rest of the game": Suncleanser, Stigma Lasher), the sentence opens with it (after a "Whenever ..., " head) (a leading "as long as ...," or "during your turn," / "during combat," is allowed), and every verb of the predicate is a known one; any other word refuses.
 *  Refused: a duration or a condition anywhere in the sentence ("this turn", "until", "next turn", "unless", "if", "who", "except", "for the rest": Orim's Chant, Silence, Sphinx's Decree, Academic Probation, Ward of Bones),
 *  "you" (a drawback), a quoted grant or an emblem's line, and reminder text.
 *  An emblem's lock ("You get an emblem with 'Your opponents can't cast noncreature spells'": Narset Transcendent, Dovin Baan) derives on the EMBLEM's own node; the card's `emblem` ability carries `Ability.emblemLock` (derive 528), because no card rule reads the node.
 *  CEILING: a quoted grant stays unread; "during combat" is a cast-ban with no flag of its own; a conditional subject is read only for the three printed shapes `LOCK_SUBJECTS` lists (Damping Engine, Ward of Bones, Wardscale Dragon), any other ("Each opponent who has cast a spell from their hand this turn": Angelic Arbiter) is left unread. */
export type PlayerLockKind = "cast-limit" | "cast-ban" | "draw" | "draw-limit" | "search" | "gain-life" | "play-land" | "pay-cost" | "cycle" | "counters" | "loyalty" | "activate" | "untap-limit";
export interface PlayerLock {
  locks: PlayerLockKind[];
  control: "opp" | "any";
  yourTurn?: true;
}

/** [the words that open the sentence, whose players, whether a PRINTED DURATION is required]: "that player" (Suncleanser, Stigma Lasher) names a player an earlier sentence or trigger picked, so it is read only beside "for as long as" or "for the rest of the game". */
const LOCK_SUBJECTS: readonly (readonly [string, "opp" | "any", boolean])[] = [
  // SOME players (owner 2026-11-14): the players a condition names ("A player who controls more permanents than each other player": Damping Engine; "Each opponent who controls more creatures than you": Ward of Bones) and "defending player" beside "As long as this creature is attacking" (Wardscale Dragon).
  ["a player who controls more permanents than each other player ", "any", false], ["each opponent who controls more creatures than you ", "opp", false], ["each opponent who controls more lands than you ", "opp", false], ["defending player ", "opp", false],
  ["your opponents ", "opp", false], ["each opponent ", "opp", false], ["opponents ", "opp", false], ["each other player ", "opp", false], ["other players ", "opp", false],
  ["each player ", "any", false], ["players ", "any", false], ["enchanted player ", "any", false], ["target opponent ", "opp", true], ["that player ", "any", true],
];
const LOCK_DURATION = /\bfor as long as\b|\bfor the rest of the game\b/;
const LOCK_DURATION_ALL = /\bfor as long as\b|\bfor the rest of the game\b/g;
const LOCK_REFUSED = /\b(?:this turn|until|next turn|unless|if|who|except|for the rest|instead|whenever|when)\b/;
const LOCK_VERBS: ReadonlySet<string> = new Set(["cast", "draw", "gain", "play", "search", "cycle", "get", "activate", "untap", "pay"]);
const NEGATION_AT_START = /^(?:can['\u2019]t|cannot) /;
const PLAY_LAND_WORD = /^(?:lands?|nonbasic|basic)\b/;

/** The sentences of a clause a lock can be read from, one per period or line, with quotes and reminder text cut out. */
function lockSentences(clauseText: string): string[] {
  const bare = clauseText.replace(/\([^()]*\)/g, " ").replace(/"[^"]*"/g, " ").replace(/\u201c[^\u201c\u201d]*\u201d/g, " ");
  return bare.split(/\n|\u2022|\. /).map((x) => x.trim().replace(/\.$/, "").toLowerCase()).filter((x) => x !== "");
}

/** The locks one predicate ("cast more than one spell each turn", "draw cards or gain life") names, or undefined when any of its words is not on the whitelist. */
function predicateLocks(pred: string): PlayerLockKind[] | undefined {
  const w = words(pred.replace(/['\u2019]/g, "'"));
  if (w.length === 0 || !LOCK_VERBS.has(w[0]!)) return undefined;
  if (w[0] === "pay") return w[1] === "life" ? ["pay-cost"] : undefined;
  const out: PlayerLockKind[] = [];
  const add = (k: PlayerLockKind): void => { if (!out.includes(k)) out.push(k); };
  for (let i = 0; i < w.length; i++) {
    if (i > 0 && !(LOCK_VERBS.has(w[i]!) && (w[i - 1] === "or" || w[i - 1] === "and"))) continue;
    const verb = w[i]!, next = w[i + 1] ?? "";
    const more = next === "more" && w[i + 2] === "than";
    const eachTurn = w.slice(i).join(" ").includes(" each turn");
    if (verb === "cast") add(more ? (eachTurn ? "cast-limit" : "cast-ban") : "cast-ban");
    else if (verb === "draw") { if (more && !eachTurn) return undefined; add(more ? "draw-limit" : "draw"); }
    else if (verb === "gain") { if (next !== "life") return undefined; add("gain-life"); }
    else if (verb === "play") { if (!PLAY_LAND_WORD.test(next)) return undefined; add("play-land"); }
    else if (verb === "search") { if (!/^(?:libraries|librar(?:y|ies)|their|a|your)$/.test(next)) return undefined; add("search"); }
    else if (verb === "cycle") add("cycle");
    else if (verb === "get") { if (next !== "counters") return undefined; add("counters"); }
    else if (verb === "activate") add(/\bloyalty abilities\b/.test(pred) && !/\bmana abilities\b/.test(pred) ? "loyalty" : /^planeswalkers'?$/.test(next) ? "loyalty" : "activate");
    else if (verb === "untap") { if (!more || !pred.includes("untap step")) return undefined; add("untap-limit"); }
  }
  return out.length > 0 ? out : undefined;
}

/** The lock a `cant` action is, read off the printed clause: `object` picks the sentence (its first known verb must open one of the lock's predicate words), `occurrence` the n-th of several alike. */
export function playerLockOf(object: string, clauseText = "", occurrence = 0): PlayerLock | undefined {
  if (clauseText === "") return undefined;
  const objectVerb = words(object).find((x) => LOCK_VERBS.has(x));
  if (objectVerb === undefined) return undefined;
  const reads: PlayerLock[] = [];
  for (const sentence of lockSentences(clauseText)) {
    let s = sentence;
    let yourTurn = / during your turn$/.test(s) || /^during your turn, /.test(s);
    for (;;) {
      if (s.startsWith("during your turn, ")) s = s.slice("during your turn, ".length);
      else if (s.startsWith("during combat, ")) s = s.slice("during combat, ".length);
      else if (s.startsWith("as long as ")) { const comma = s.indexOf(", "); if (comma < 0) break; s = s.slice(comma + 2); }
      else break;
    }
    // A trigger head ("Whenever this creature deals damage to a player, that player can't gain life for the rest of the game": Stigma Lasher) is not part of the lock's own sentence.
    if (/^(?:whenever|when) /.test(s)) { const comma = s.indexOf(", "); if (comma < 0) continue; s = s.slice(comma + 2); }
    const who = LOCK_SUBJECTS.find(([lead]) => s.startsWith(lead));
    if (!who) continue;
    const rest = s.slice(who[0].length);
    if (!NEGATION_AT_START.test(rest)) continue;
    if (who[2] && !LOCK_DURATION.test(rest)) continue;
    // "the spell most recently cast this turn" (Mana Maze) describes a spell, it is no duration.
    if (LOCK_REFUSED.test(rest.replace(LOCK_DURATION_ALL, " ").replace("most recently cast this turn", " "))) continue;
    const pred = rest.replace(NEGATION_AT_START, "");
    const locks = predicateLocks(pred);
    if (!locks) continue;
    if (!words(pred).includes(objectVerb)) continue;
    yourTurn = yourTurn || /\bduring your turn\b/.test(pred);
    reads.push({ locks, control: who[1], ...(yourTurn ? { yourTurn: true as const } : {}) });
  }
  return reads[Math.min(occurrence, reads.length - 1)];
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// 3. UNTAP-DENIAL
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** HOW LONG A PERMANENT STAYS TAPPED (#1423; CR 502.3: "effects can keep one or more of a player's permanents from untapping"). `continuous`: every untap step while the effect lasts (an Aura's or a static's
 *  "doesn't untap during its controller's untap step": Hold for Questioning, Encrust, Choke); `next-untap-step`: only the next one (Frost Trickster), or the next `steps` of them ("next two untap
 *  steps", Telekinesis; `steps` is written only above 1); `as-long-as`: a printed duration ("for as long as you control this creature", "for as long as this artifact remains tapped": Icefall Regent, Kill Switch).
 *  Who stays tapped is `effect.subject` (the card itself, a class, an Aura's host: `Ability.host`; a pronoun or a list is unnamed). */
export interface UntapDenial {
  duration: "continuous" | "next-untap-step" | "as-long-as";
  steps?: number;
  conditional?: true;
}

const NEG_UNTAP = /\b(?:doesn['\u2019]t|don['\u2019]t|does not|do not|can['\u2019]t|cannot|won['\u2019]t)\s+untap\b/gi;
const NEGATED_UNTAP_ONCE = new RegExp(NEG_UNTAP.source, "i");
/** "If this creature would untap during your untap step, remove a +1/+1 counter from it instead" as the quoted grant of an Aura: the host stays tapped unless it pays. Bewitching Leechcraft is the one corpus card; "a permanent with a wind counter" (Freyalise's Winds) and "a creature you control" (Edge of Malacol) name no host and are not it. */
const UNTAP_COSTS_INSTEAD = /^(?:(?:enchanted creature|that creature) (?:gains?|has|have) )?["\u201c]if (?:this creature|it) would untap during your untap step, [^"\u201d]* instead\b/i;
const STEP_COUNT: Readonly<Record<string, number>> = { two: 2, three: 3, four: 4, five: 5 };
const UNTAP_PRONOUN = /^(?:it|they|them|that (?:creature|permanent|land|artifact|player)|those (?:creatures|permanents|lands|artifacts)|the chosen creature)$/i;

/** "doesn't untap during its controller's untap step" in all its printed shapes (CR 502.3), read off the PRINTED sentence: the model drops the subject on most cards and writes "untap during ..." as the
 *  object of a `cant`. A CONDITION in the sentence (a leading "If you win," / "As long as enchanted creature isn't legendary," or a trailing "if it has a depletion counter on it" / "unless ...") makes the denial
 *  `conditional` (owner 2026-11-14, #1266: it still holds while the condition does); read, never refused. Refused: a PERMISSION ("You may choose not to untap", Amber Prison: no negation is printed); and any "until". A trigger head, an activation cost, a leading
 *  "for as long as ..." (the duration) and the activated-abilities rider of Hold for Questioning and Encrust ("... and its activated abilities can't be activated unless ...") are not conditions.
 *  Conditional printings (Veldt and Lava Tubes' depletion counter, Walking Dream, Tangle Kelp, Stunning Strike, Pollen Lullaby's "If you win", Guardian of Tazeem's "If that land is an Island") were
 *  left unread until derive 528, so as not to read a partial denial as total; they carry `conditional` now. Measured 2026-10-30, before that over the 328 corpus cards printing a negated untap outside reminder text: 280 read,
 *  6 not derived at all, 42 unread = 32 conditional (a quoted grant included), 9 "can't untap MORE THAN N" limits (Static Orb, Winter Orb, Damping Field, Winter Moon, Smoke, Stoic Angel, Imi Statue,
 *  Mungha Wurm, Dovin Baan's emblem: a limit, not a denial) and Leviathan ("enters tapped and doesn't untap", the stored answer holds no usable `cant`). A list recipient ("Creatures and lands target
 *  opponent controls") is left unnamed.
 *  Returns the recipient's words as `who` (undefined when the sentence names none or a pronoun). */
export function untapDenialOf(object: string, clauseText = "", occurrence = 0): { denial: UntapDenial; who?: string } | undefined {
  if (!/\buntap/i.test(object)) return undefined;
  const implied = clauseText === "";
  const text = implied ? object : clauseText;
  const hit = nthMatch(text, NEG_UNTAP, occurrence);
  if (!hit && !implied) return undefined;
  // With no clause text the object is the sentence and the verb is the negation: "untap during ..." (subject dropped) or "enchanted creature doesn't untap ..." (kept).
  const at = hit ? hit.index : text.search(/\buntap\b/i);
  if (at < 0) return undefined;
  const start = sentenceStart(text, at);
  let head = text.slice(start, at).trim();
  const afterNegation = text.slice(hit ? at + hit[0].length : at + "untap".length);
  const end = afterNegation.indexOf(". ");
  const sentenceTail = (end < 0 ? afterNegation : afterNegation.slice(0, end)).replace(/\.$/, "");
  // An activation cost ("{T}, Sacrifice this artifact: ...") and a trigger head ("Whenever this creature blocks a creature, ...") are not part of the recipient.
  const colon = head.indexOf(":");
  if (colon >= 0 && colon <= 60 && !head.includes('"')) head = head.slice(colon + 1).trim();
  if (/^(?:when|whenever|at)\b/i.test(head)) { const comma = head.indexOf(","); if (comma < 0) return undefined; head = head.slice(comma + 1).trim(); }
  // A LEADING DURATION: "For as long as this creature remains tapped, target tapped creature doesn't untap ..." (Giant Oyster).
  let longAs = false;
  if (/^for as long as\b/i.test(head)) { const comma = head.indexOf(","); if (comma < 0) return undefined; head = head.slice(comma + 1).trim(); longAs = true; }
  // A LEADING CONDITION ("As long as you control another snow permanent, enchanted creature doesn't untap ...": Winter's Rest; "As long as enchanted creature isn't legendary, it ...": Stunning Strike) leaves the denial in force while it holds: read, and flagged `conditional` (owner 2026-11-14, #1266).
  let conditional = false;
  if (/^(?:if|as long as)\b/i.test(head)) { const comma = head.indexOf(","); if (comma < 0) return undefined; head = head.slice(comma + 1).trim(); conditional = true; }
  if (/\b(?:if|unless|as long as|while|during|except|only|when|whenever)\b/i.test(head)) return undefined;
  // The other limb of Hold for Questioning / Encrust belongs to ability-loss, with its own "unless they're mana abilities".
  const tail = sentenceTail.split(/,? and (?:its|their) activated abilities\b/i)[0]!.toLowerCase();
  if (/\b(?:except|only|while|until)\b/.test(tail)) return undefined;
  if (/\b(?:if|unless)\b/.test(tail)) conditional = true;
  // "can't untap MORE THAN one artifact" (Damping Field, Winter Moon, Static Orb) limits the untap, it does not deny it.
  if (tail.trim().startsWith("more than")) return undefined;
  const lead = tail.indexOf("as long as");
  if (lead >= 0 && !tail.slice(0, lead).endsWith("for ")) conditional = true;
  longAs = longAs || (lead >= 0 && tail.slice(0, lead).endsWith("for "));
  const next = /\bnext (?:(two|three|four|five) )?untap steps?\b/.exec(tail);
  const duration: UntapDenial["duration"] | undefined = longAs ? "as-long-as" : next ? "next-untap-step" : /\buntap steps?\b/.test(tail) ? "continuous" : undefined;
  if (duration === undefined) return undefined;
  const steps = next?.[1] ? STEP_COUNT[next[1]] : undefined;
  const denial: UntapDenial = { duration, ...(steps && steps > 1 ? { steps } : {}), ...(conditional ? { conditional: true as const } : {}) };
  // THE RECIPIENT: the words ahead of the verb, up to a "gets / has / loses / enters / deals" (Reveka's "deals 2 damage to any target and doesn't untap" is Reveka's) (Dance of the Dead: "Enchanted creature gets +1/+1 and doesn't untap ..."), without a trailing "and".
  const who = head.split(/\s(?=(?:gets?|gains?|has|have|loses?|enters|deals?)\b)/i)[0]?.trim().replace(/ and$/i, "").replace(/^(?:and|then|but|also) /i, "");
  return { denial, ...(who && !UNTAP_PRONOUN.test(who) && !/,| (?:and|or) /i.test(who) ? { who } : {}) };
}

const UNTAP_STEP = /\buntap (?:steps?|phases?)\b/gi;
/** Is every "untap" in the clause a negated one (or the word of an "untap step")? Then a stored `untap` action is the negation, not a positive untap. */
function onlyNegatedUntaps(text: string): boolean {
  return !/\buntaps?\b/i.test(text.replace(NEG_UNTAP, " ").replace(UNTAP_STEP, " "));
}

/** `untapDenialOf` for the verb the model stored. The model files "doesn't untap" mostly as a `cant`, but also as the POSITIVE verb `untap` (Melancholy, Thirst, Energy Storm, Reveka: read as "untaps a
 *  permanent" -- the opposite of the card). THE WORDS DECIDE, as they do for `retarget`: a stored `untap` is the denial only when every "untap" the printed clause holds is negated (a clause that also untaps
 *  something keeps its `untap`). Any other verb is not read: Dread Wight's denial, filed as a `grant-ability`, is rewritten to "that ability" before it reaches here. */
export function untapDenialFor(verb: string, object: string, clauseText: string, occurrence = 0): ReturnType<typeof untapDenialOf> {
  if (verb === "cant") return untapDenialOf(object, clauseText, occurrence);
  if (clauseText === "") return undefined;
  if (verb === "untap") return onlyNegatedUntaps(clauseText) ? untapDenialOf("untap", clauseText, 0) : undefined;
  // A DENIAL THE MODEL FILED AS A GRANT (owner 2026-11-14, #1266): Dread Wight's "Each of those creatures doesn't untap ... for as long as it has a paralyzation counter on it", the quoted "This creature doesn't untap during your untap step if it has a glyph counter on it" of Glyph of Delusion and Mindbender Spores.
  if (verb === "grant-ability") {
    if (NEGATED_UNTAP_ONCE.test(object)) return untapDenialOf(object, clauseText, 0);
    // "Enchanted creature has 'If this creature would untap during your untap step, remove a +1/+1 counter from it instead. If you do, untap it.' (Otherwise, it doesn't untap.)" (Bewitching Leechcraft): the untap costs a counter, so it is conditional.
    if (UNTAP_COSTS_INSTEAD.test(object)) return { denial: { duration: "continuous", conditional: true } };
  }
  return undefined;
}
