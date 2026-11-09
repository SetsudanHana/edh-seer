import type { GameEvent, SubjectFilter } from "@edh-seer/tagger";
import { withoutParentheses } from "@edh-seer/tagger/reminder";
import { subjectMatches } from "./subject.js";
import type { Hierarchy } from "./types.js";

/** CAN THIS PRODUCER REMOVE A PERMANENT THAT IS THE AURA, FROM THE BATTLEFIELD? (#1513 part 2, review round). Read for an Aura whose own leave trigger acts on its host (`Ability.actsOnHost`: Parallax Dementia,
 *  Reality Acid): the host route is false when the Aura left because its host did, and a producer keeps its pair only if one of its removal events could take the Aura itself.
 *  An event counts when it removes (dies / leaves / exiled / sacrifice) something that is typed like the Aura (enchantment, permanent, Aura), and
 *   - comes from the BATTLEFIELD: not a hand or graveyard exile (`fromZone`, `zone: graveyard`), not "that card" of a trigger (`ref: trigger`);
 *   - is no token;
 *   - is not aimed only at an opponent: a TARGET counts whatever control it is stored with, unless the printed targeting sentences of the card all say "an opponent controls" / "you don't control" / "your opponents control";
 *     a mass event counts when its control is you or any;
 *   - is no opponent's edict or may-decline sacrifice: "target opponent sacrifices ..." (Invoke Despair), "target opponent loses 3 life unless they sacrifice ..." (Starseer Mentor), a stored `edict` aimed at a target;
 *   - is not the Aura taken WITH its host: an `attached-to` event on a card that also removes creatures (End Hostilities: "all creatures and all permanents attached to creatures").
 *  The comparison with the Aura carries the type, subtype, anyOf, notType, notSubtype, colors, colorCount and historic of the event. A merged "Spirit, creature with disturb, or enchantment" is stored one subtype
 *  on a type list: the subtype belongs to one alternative, so a list drops it (Thraben Exorcism).
 *  CEILING: the printed cues are read over the whole card (a card with an opponent-only mode and an unrestricted one keeps the unrestricted); a type-list subtype is dropped for every alternative, so a subtype on the
 *  Aura-matching alternative is not held against it; an `attached-to` event is taken as host-taking only beside a creature removal; Saw and Mythos of Nethroi are stored creature-only by derive, so their enchantment
 *  alternative is not seen (#1575). Kept-set read at an even stride, 30 of 1,522 commander-legal pairs: 28 reach the Aura; the 2 false keeps are Elspeth Conquers Death (its chapter I is opponent-only, chapter III unrestricted:
 *  the whole-card cue) and Cut the Earthly Bond ("target enchanted permanent" takes the host, not the Aura). Linear scans only. */
const REMOVAL_VERBS = new Set(["dies", "leaves", "exiled", "sacrifice"]);
const OPPONENT_ONLY = ["an opponent controls", "you don't control", "your opponents control", "an opponent owns"];
const TARGETING_VERBS = ["destroy", "exile", "return", "put", "sacrifice"];

function sentences(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const c of withoutParentheses(text).replace(/’/g, "'").toLowerCase()) {
    if (c === "." || c === "\n" || c === "•" || c === "—") { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur);
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
  return aimed.length > 0 && aimed.every((s) => OPPONENT_ONLY.some((cue) => s.includes(cue)) || conditionExcludes(s, auraColors));
}

/** A sentence in which an opponent is named before the sacrifice: "target opponent sacrifices", "each opponent sacrifices", "target opponent loses 3 life unless they sacrifice". */
export function opponentSacrifices(text: string): boolean {
  return sentences(text).some((s) => { const o = s.indexOf("opponent"); return o >= 0 && s.indexOf("sacrifice", o) > o; });
}

export function removalReachesAura(producer: readonly GameEvent[], text: string, aura: SubjectFilter, h: Hierarchy): boolean {
  const opponentOnlyTargets = targetsOnlyOpponents(text, aura.colors ?? []);
  const edictCue = opponentSacrifices(text);
  const removesCreatures = producer.some((x) => REMOVAL_VERBS.has(x.verb) && x.subject.selection !== "attached-to" && x.implied !== true && x.subject.self !== true && [x.subject.type].flat().includes("creature"));
  return producer.some((x) => {
    const s = x.subject;
    if (x.implied === true || s.self === true || !REMOVAL_VERBS.has(x.verb)) return false;
    if ((s.fromZone !== undefined && s.fromZone !== "battlefield") || s.zone === "graveyard" || s.ref === "trigger" || s.token === true) return false;
    if (s.selection === "attached-to" && removesCreatures) return false;
    if (s.control !== "you" && (x.verb === "sacrifice" || s.edict === true || x.victimMay === true) && edictCue) return false;
    if (s.edict === true && s.scope === "target") return false;
    if (s.scope === "target") { if (opponentOnlyTargets) return false; } else if (s.control === "opp") return false;
    const { type, subtype, anyOf, notType, notSubtype, colors, colorCount, historic } = s;
    const mergedList = Array.isArray(type) && type.length > 1;
    const kinds: SubjectFilter = {
      control: "any", token: null,
      ...(type !== undefined ? { type } : {}), ...(subtype !== undefined && !mergedList ? { subtype } : {}), ...(anyOf !== undefined ? { anyOf } : {}),
      ...(notType !== undefined ? { notType } : {}), ...(notSubtype !== undefined ? { notSubtype } : {}),
      ...(colors !== undefined ? { colors } : {}), ...(colorCount !== undefined ? { colorCount } : {}), ...(historic !== undefined ? { historic } : {}),
    };
    return subjectMatches(aura, kinds, h);
  });
}
