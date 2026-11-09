import type { GameEvent, SubjectFilter } from "@edh-seer/tagger";
import { withoutParentheses } from "@edh-seer/tagger/reminder";
import { subjectMatches } from "./subject.js";
import type { Hierarchy } from "./types.js";

/** CAN THIS PRODUCER REMOVE A PERMANENT THAT IS THE AURA, FROM THE BATTLEFIELD? (#1513 part 2, review round). Read for an Aura whose own leave trigger acts on its host (`Ability.actsOnHost`: Parallax Dementia,
 *  Reality Acid): the host route is false when the Aura left because its host did, and a producer keeps its pair only if one of its removal events could take the Aura itself.
 *  The same test, one event at a time (`eventReachesAura`), is the DIRECT route (#1575): an enchantment- or permanent-typed removal against the Aura's own self trigger (edges.ts `auraOwnLeaves`), so both routes agree on what can reach an Aura.
 *  An event counts when it removes (dies / leaves / exiled / sacrifice) something that is typed like the Aura (enchantment, permanent, Aura), and
 *   - comes from the BATTLEFIELD: not a hand or graveyard exile (`fromZone`, `zone: graveyard`), not "that card" of a trigger (`ref: trigger`);
 *   - is no token;
 *   - is not aimed only at an opponent: a TARGET counts whatever control it is stored with, unless the printed targeting sentences of the card all say "an opponent controls" / "you don't control" / "your opponents control";
 *     a mass event counts when its control is you or any;
 *   - is no opponent's edict or may-decline sacrifice: "target opponent sacrifices ..." (Invoke Despair), "target opponent loses 3 life unless they sacrifice ..." (Starseer Mentor), a stored `edict` aimed at a target;
 *   - is not the Aura taken WITH its host: an `attached-to` event on a card that also removes creatures (End Hostilities: "all creatures and all permanents attached to creatures").
 *  Only an event that NAMES A CLASS (a type, a subtype, an `anyOf` branch with one: `namesAClass`) counts on the host route as on the direct one (#1577): a bare "it" ("Destroy target creature. Return it ...") says nothing about an Aura.
 *  The comparison with the Aura carries the type, subtype, anyOf, notType, notSubtype, colors, colorCount and historic of the event. "Spirit, creature with disturb, or enchantment" (Thraben Exorcism) is stored as three `anyOf` alternatives (#1575), each with its own subtype, so no
 *  subtype is dropped here any more.
 *  CEILING: the printed cues are read over the whole card (a card with an opponent-only mode and an unrestricted one keeps the unrestricted); an `attached-to` event is taken as host-taking only beside a creature removal. Kept-set read at an even stride, 30 of 1,522 commander-legal pairs: 28 reach the Aura; the 2 false keeps are Elspeth Conquers Death (its chapter I is opponent-only, chapter III unrestricted:
 *  the whole-card cue) and Cut the Earthly Bond ("target enchanted permanent" takes the host, not the Aura). Linear scans only. */
const REMOVAL_VERBS = new Set(["dies", "leaves", "exiled", "sacrifice"]);
const OPPONENT_ONLY = ["an opponent controls", "you don't control", "your opponents control", "an opponent owns"];
/** "THAT PLAYER CONTROLS" AND "DEFENDING PLAYER CONTROLS" (#1577). The defending player is an opponent of the attacker whoever asks (Kogla, Outland Liberator). "That player" is one only where the SAME sentence says who it is: an opponent named before it
 *  ("for each opponent, destroy target artifact that player controls": Dismantling Wave), or the player our own creature dealt damage to ("Whenever this creature deals combat damage to a player, destroy target artifact that player controls": Aberrant,
 *  Dawning Purist; "equipped creature": Hammer of Ruin; "Cats you control deal combat damage": Feline Sovereign). Not "for each player" (Battle at the Helvault), "each player's upkeep" (The Abyss), "enchanted creature deals damage to a player" (Sigil of Sleep:
 *  an Aura goes on an opponent's creature too), and not a sentence that only follows another ("When you do, exile target artifact that player controls": Kappa Tech-Wrecker).
 *  CEILING: a dealer named by the card's own name ("Whenever Etrata deals combat damage to a player") is not read as ours (the text carries no marker), so those keep their pair; so does an antecedent in an earlier sentence (Fatal Lore, the reflexive "When you do"). */
const OWN_DEALER_STARTS = ["whenever this ", "when this ", "whenever equipped creature "];
function thatPlayerIsOpponent(s: string, at: number): boolean {
  const before = s.slice(0, at);
  if (before.includes("opponent")) return true;
  const dmg = before.indexOf(" damage to a player");
  if (dmg < 0) return false;
  const dealer = before.slice(0, dmg);
  return OWN_DEALER_STARTS.some((p) => dealer.startsWith(p) || dealer.includes(`, ${p}`)) || (dealer.includes(" you control ") && !dealer.includes("enchanted"));
}
function namesOpponentPlayer(s: string): boolean {
  if (s.includes("defending player controls")) return true;
  const at = s.indexOf("that player controls");
  return at >= 0 && thatPlayerIsOpponent(s, at);
}

const TARGETING_VERBS = ["destroy", "exile", "return", "put", "sacrifice"];

function sentences(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const c of withoutParentheses(text).replace(/’/g, "'").toLowerCase()) {
    if (c === "." || c === "\n" || c === "•" || c === "—") { out.push(cur.trim()); cur = ""; } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

const COLOUR_LETTER: Record<string, string> = { white: "W", blue: "U", black: "B", red: "R", green: "G" };
/** "Destroy target permanent if it's blue" (Pyroblast): derive drops the condition on the target, so its colour is read here against the Aura's. */
function conditionExcludes(sentence: string, auraColors: readonly string[]): boolean {
  const at = sentence.indexOf(" if it's ");
  if (at < 0) return false;
  const word = sentence.slice(at + 9).split(" ")[0]!;
  const letter = COLOUR_LETTER[word];
  return letter !== undefined && !auraColors.includes(letter);
}

/** Every printed sentence that aims a removal at a target says the target is an opponent's, or is a colour the Aura is not. */
export function targetsOnlyOpponents(text: string, auraColors: readonly string[] = []): boolean {
  const aimed = sentences(text).filter((s) => s.includes("target") && TARGETING_VERBS.some((v) => s.includes(v)));
  return aimed.length > 0 && aimed.every((s) => OPPONENT_ONLY.some((cue) => s.includes(cue)) || namesOpponentPlayer(s) || conditionExcludes(s, auraColors));
}

/** A sentence in which an opponent is named before the sacrifice: "target opponent sacrifices", "each opponent sacrifices", "target opponent loses 3 life unless they sacrifice". */
export function opponentSacrifices(text: string): boolean {
  return sentences(text).some((s) => { const o = s.indexOf("opponent"); return o >= 0 && s.indexOf("sacrifice", o) > o; });
}

/** What the WHOLE producer card says, read once per pair: the printed cues and whether it also removes creatures. */
export interface AuraReachContext { opponentOnlyTargets: boolean; edictCue: boolean; removesCreatures: boolean }

export function auraReachContext(producer: readonly GameEvent[], text: string, aura: SubjectFilter): AuraReachContext {
  return {
    opponentOnlyTargets: targetsOnlyOpponents(text, aura.colors ?? []),
    edictCue: opponentSacrifices(text),
    removesCreatures: producer.some((x) => REMOVAL_VERBS.has(x.verb) && x.subject.selection !== "attached-to" && x.implied !== true && x.subject.self !== true && [x.subject.type].flat().includes("creature")),
  };
}

/** Could THIS event take the Aura itself (the rules in the header)? The one test both routes use: the host route (`removalReachesAura`) over the producer's events, and the direct route (an enchantment- or permanent-typed removal
 *  against the Aura's own self trigger, edges.ts) over each event. */
export function eventReachesAura(x: GameEvent, ctx: AuraReachContext, aura: SubjectFilter, h: Hierarchy): boolean {
  const s = x.subject;
  if (x.implied === true || s.self === true || !REMOVAL_VERBS.has(x.verb)) return false;
  if ((s.fromZone !== undefined && s.fromZone !== "battlefield") || s.zone === "graveyard" || s.ref === "trigger" || s.token === true) return false;
  if (s.selection === "attached-to" && ctx.removesCreatures) return false;
  if (s.control !== "you" && (x.verb === "sacrifice" || s.edict === true || x.victimMay === true) && ctx.edictCue) return false;
  if (s.edict === true && s.scope === "target") return false;
  if (s.scope === "target") { if (ctx.opponentOnlyTargets) return false; } else if (s.control === "opp") return false;
  const { type, subtype, anyOf, notType, notSubtype, colors, colorCount, historic } = s;
  const kinds: SubjectFilter = {
    control: "any", token: null,
    ...(type !== undefined ? { type } : {}), ...(subtype !== undefined ? { subtype } : {}), ...(anyOf !== undefined ? { anyOf } : {}),
    ...(notType !== undefined ? { notType } : {}), ...(notSubtype !== undefined ? { notSubtype } : {}),
    ...(colors !== undefined ? { colors } : {}), ...(colorCount !== undefined ? { colorCount } : {}), ...(historic !== undefined ? { historic } : {}),
  };
  return subjectMatches(aura, kinds, h);
}

/** THE EVENT NAMES A CLASS (#1577): a type, a subtype, or an `anyOf` branch with one. An untyped removal (a bare "it": Bomb Squad's destroy, Cut the Tethers' return of a Spirit, Slogurk's self-bounce) states no class that could be an Aura. */
export function namesAClass(s: SubjectFilter): boolean {
  return s.type !== undefined || s.subtype !== undefined || (s.anyOf ?? []).some((b) => b.type !== undefined || b.subtype !== undefined);
}

/** The host route's test, over the producer's whole card: an event counts only if it names a class (`namesAClass`, the gate the direct route has had since #1575) and `eventReachesAura` says it could take the Aura. */
export function removalReachesAura(producer: readonly GameEvent[], text: string, aura: SubjectFilter, h: Hierarchy): boolean {
  const ctx = auraReachContext(producer, text, aura);
  return producer.some((x) => namesAClass(x.subject) && eventReachesAura(x, ctx, aura, h));
}
