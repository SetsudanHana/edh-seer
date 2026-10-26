/** WHAT A VERB READS AS IN PRINTED TEXT, and whether an action's verb is printed anywhere it could have come from (#1321).
 *  The model sometimes files an unrelated sentence under a verb the text never states (Crown of Awe's "gain protection" as gain-control; "repeat this process" as trigger-again;
 *  "look at the top N" as scry). `verbPrint` classifies an action against the PRINTED text:
 *   - "own":  its own clause (cost included; reminder text stripped, except on a short keyword line, where the reminder IS the action) prints one of the verb's words;
 *   - "card": it does not, but the card's whole printed text does -- a CLAUSE MIX-UP (the action belongs to another clause: Carrot Cake's Rabbit): KEPT, counted;
 *   - "none": nowhere on the card -- MISFILED: dropped when the verb is in `GUARDED_VERBS`, so the action falls to `unclaimed`.
 *  Anchored words and bounded gaps only (CodeQL js/polynomial-redos): linear on any input. The research census (research/tagger/verb-printed-census.ts) imports THIS table, so the two cannot drift. */
import { isEnergyObject } from "./effect-kind.js";

// STAR TREK (#1349, owner 2026-10-26): "assimilate <card>" puts a +1/+1 counter on it (its `add-counter`); the reminder that says so is stripped from the clause, so the
// keyword itself is the printed word of the action it stands for. ("Beam me up {cost}" needs none: its short line is tested with its reminder, below.)
const KEYWORD = (w: string): string => `${w}(?:s|es|ed|ing)?`;
export const VERB_WORDS: Readonly<Record<string, string>> = {
  "sacrifice": "sacrifice(?:s|d)?|sacrificing",
  "exile": "exil(?:e|es|ed|ing)", "destroy": "destroy(?:s|ed|ing)?|destruction", "tap": "tap(?:s|ped|ping)?|\\{t\\}", "untap": "untap(?:s|ped|ping)?|\\{q\\}",
  "draw": "draw(?:s|ing)?|drew", "mill": "mill(?:s|ed)?|graveyard", "search": "search(?:es|ed|ing)?|look(?:s)? at|reveals? cards? from the top", "put": "puts?|placed?|placing|putting|enters?|entered|begin the game|moves?|shuffles? [^.]{0,60} into|onto the battlefield",
  "return": "returns?|returned|returning|back|onto the battlefield|into (?:your|their|its owner's|their owners'|that player's|his or her|target player's)[^.]{0,20}(?:hands?|librar(?:y|ies)|graveyards?)|until [^.]{0,60} leaves the battlefield|until [^.]{0,60} leaves play", "counter-spell": "counters?|countered",
  "copy": "cop(?:y|ies|ied|ying)", "gain-life": "gains?|gained|life|lifelink", "lose-life": "loses?|lost|life", "deal-damage": "deals?|dealt|damage",
  "add-mana": "adds?|added|mana", "add-counter": "puts?|put|counters?|bolster|adapt|proliferate|support|distribute|moves?|gets? \\{e\\}|enters? with|enters the battlefield with|place|assimilate",
  "remove-counter": "pays?|paid|\\{e\\}|removes?|removed|counters?|proliferate", "grant-ability": "gains?|gained|has|have|had|with|gets?|can|can't|cannot|protection|haste|flying|lifelink|deathtouch|trample|vigilance|first strike|double strike|menace|reach|hexproof|indestructible|ward|keyword|ability|abilities|\\bis\\b|\\bare\\b|becomes?|loses?|doesn't|don't",
  "modify-pt": "\\d+/\\d+|gets?|get|[+-]\\d+/[+-]\\d+|[+-]x/[+-]x|base power|power|toughness|becomes?|has|have|with|equal to|swap|exchange|double|triple",
  "prevent": "protection from|prevent(?:s|ed)?|prevention|instead|redirect|can't|cannot|won't|doesn't|don't|would be dealt",
  "cast": "cast(?:s|ing)?|casts?|play|plays|copy|copies", "play": "plays?|played|playing|cast(?:s|ing)?|land|lands",
  "shuffle": "shuffl(?:e|es|ed|ing)", "reveal": "reveal(?:s|ed|ing)?|shows?|look(?:s|ed)? at", "attach": "attach(?:es|ed|ing)?|equip(?:ped)?|fortif(?:y|ied)|enchant(?:ed)?|aura|reconfigure|bestow|unattach",
  "transform": "transform(?:s|ed|ing)?|daybound|nightbound|disturb|meld|flip|convert|back face|day|night", "trigger-again": "trigger(?:s|ed)?|additional time|twice|an extra time|again|copy|copies|additional",
  "extra-turn": "extra turns?|additional turns?|takes? another turn|another turn", "extra-combat": "additional combat|extra combat|another combat|after this phase",
  "animate": "becomes?|is a|are|turns? into|creature|until end of turn|enchanted|equipped|isn't|loses?|gets?|has|have|with", "cant": "loses?|lose|must|if able|skip(?:s|ped)?|can't|cannot|can not|don't|doesn't|isn't|aren't|won't|may not|no more|only|unable|unless|not|no |without|instead|except",
  "emblem": "emblem", "fight": "fights?|fought|fighting", "set-life": "life|total|becomes?", "cost-modify": "spend|spent|affinity|costs?|less|more|additional|pays?|paid|payment|\\{[^}]{1,20}\\}|reduce|increase|free|without paying|alternative|instead",
  "turn-face-up": "face[- ]up|turns? [^.]{0,60} face|unmorph|megamorph|manifest|disguise|morph|cloak|face down|face-down",
  "extra-phase": "additional|extra|another|phase", "manifest-dread": "manifest dread", "time-travel": "time travel", "collect-evidence": "collect evidence",
  "venture-into-the-dungeon": "venture", "face-a-villainous-choice": "villainous choice", "ring-tempts": "ring tempts|the ring", "roll-dice": "rolls?|rolled|dice|die",
  "flip-coin": "flips?|flipped|coin", "city-blessing": "city's blessing|ascend", "gain-control": "gains? control|takes? control|under [^.]{0,60} control|controls?|exchange control|control of",
  "phase-out": "phases? out|phased out", "phase-in": "phases? in|phased in", "win-game": "wins? the game|win the game|wins", "lose-game": "loses? the game|lose the game",
  "empower-jace": "empower|jace", "prepare": "prepar(?:e|ed)", "unprepare": "unprepar(?:e|ed)", "unattach": "unattach|attached|attach", "monarch": "monarch", "initiative": "initiative",
  "day-night": "day|night", "create": "creates?|created|token|populate|incubate|investigate|amass|clue|treasure|food|blood|map|powerstone|junk|gold|shard|copy|copies|manifest|cloak|conjure", "double": "double|twice|triple", "triple": "triple",
  "exchange": "exchange|swap|switch", "convert": "convert|transform|becomes?", "regenerate": "regenerat(?:e|es|ed|ion)", "goad": "goad(?:s|ed)?", "exert": "exert(?:s|ed)?",
  "detain": "detain(?:s|ed)?", "suspect": "suspect(?:s|ed)?", "harness": "harness(?:es|ed)?", "vote": "vot(?:e|es|ed|ing)", "clash": "clash(?:es|ed)?", "fateseal": "fateseal(?:s|ed)?",
  "behold": "behold(?:s)?", "heal": "heal|remove(?:s)? all damage|removes? damage|damage [^.]{0,60} removed", "learn": "learn(?:s)?", "endure": "endur(?:e|es|ed)", "forage": "forag(?:e|es|ed)",
  "explore": "explor(?:e|es|ed)", "connive": "conniv(?:e|es|ed|ing)", "recruit": "recruit(?:s|ed)?", "bolster": "bolster(?:s|ed)?", "support": "support(?:s|ed)?", "adapt": "adapt(?:s|ed)?",
  "monstrosity": "monstrosity|monstrous", "blight": "blight(?:s|ed)?", "investigate": "investigat(?:e|es|ed)|clue", "populate": "populat(?:e|es|ed)", "incubate": "incubat(?:e|es|ed)|incubator", "manifest": "manifest(?:s|ed)?",
  "discover": "discover(?:s|ed)?", "cloak": "cloak(?:s|ed)?", "earthbend": "earthbend(?:s|ed)?", "scry": "scry|scries", "surveil": "surveil(?:s|ed)?", "amass": "amass(?:es|ed)?", "foretell": "foretell|foretold|foretells",
  "airbend": "airbend", "waterbend": "waterbend", "proliferate": "proliferat(?:e|es|ed)",
};
/** The verbs a "none" verdict drops. One family per commit (#1321); empty until each is measured. */
export const GUARDED_VERBS: Set<string> = new Set<string>(["add-mana", "goad", "shuffle", "scry", "mill", "search", "trigger-again", "gain-life", "add-counter", "remove-counter", "transform", "prevent", "return", "roll-dice", "vote", "city-blessing"]);
/** An action the guard never drops although its verb is guarded: a reading derive has for it already (an `add-mana` of {E} is the energy counter, CR 107.14, emitted as `counter-added`). */
export function guardExempt(action: { verb?: string; object?: string }): boolean {
  return action.verb === "add-mana" && isEnergyObject(action.object ?? "");
}

const SKIP = new Set(["none", "other"]);
const wordRe = new Map<string, RegExp>();
export function printsVerbWord(verb: string, text: string): boolean {
  let re = wordRe.get(verb);
  if (!re) {
    const first = KEYWORD(verb.split("-")[0]!);
    re = new RegExp(`(?<![\\w'])(?:${VERB_WORDS[verb] ?? first}|${first})(?![\\w'])`, "i");
    wordRe.set(verb, re);
  }
  return re.test(text);
}
/** Reminder text out (parentheses do not nest in oracle text). */
export function stripReminderText(t: string): string {
  return t.replace(/\([^()]*\)/g, " ").replace(/ {2,}/g, " ").trim();
}
export type VerbPrint = "own" | "card" | "none";
/** Where this verb is printed. `clauseText` empty or undefined says nothing is known: "own" (a silent wrong answer is worse, but a drop needs evidence). */
export function verbPrint(verb: string, clauseText: string | undefined, cost: string | undefined, cardText: string | undefined): VerbPrint {
  if (SKIP.has(verb) || clauseText === undefined || clauseText === "") return "own";
  const whole = cost ? `${cost} : ${clauseText}` : clauseText;
  const stripped = stripReminderText(whole);
  // A KEYWORD LINE ("Crew 4", "Equip {3}", "Cycling {2}", "Awaken 4-{5}{U}") is its reminder text: the action IS the reminder, so a short stripped line is tested with the reminder kept.
  if (printsVerbWord(verb, stripped) || (stripped.length <= 60 && printsVerbWord(verb, whole))) return "own";
  // ...and the clause text may have lost the reminder already (segment strips it): the CARD'S RAW LINE that starts with the short clause carries it ("Awaken 4-{5}{U} (... put four +1/+1 counters ...)").
  if (stripped.length <= 60 && cardText) {
    const head = stripReminderText(clauseText);
    const line = head === "" ? undefined : cardText.split("\n").find((l) => l.startsWith(head));
    if (line !== undefined && printsVerbWord(verb, line)) return "own";
  }
  if (cardText === undefined || cardText === "") return "none";
  return printsVerbWord(verb, stripReminderText(cardText)) ? "card" : "none";
}
