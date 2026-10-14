/** THE ONE PARSE OF A MANA LINE'S GATE (#1191): the verbatim lowercase condition ("you control a dragon") becomes a `ManaGate`, once, in derive. Before this three regex grammars read the
 *  string (gate.ts, goldfish.ts, and the verge branch of land-conditions.ts); a gate one of them missed was unmet everywhere (the five "...or if you control a basic land" lands were a source
 *  of no colour in any deck). The matcher's gate.ts is the only EVALUATOR of the result; nothing outside this file parses the words of a gate.
 *  CEILING: "this land entered this turn or if you control a basic land" (Gleaming Bastion) reads only its second alternative: the entry-turn alternative is dropped, which under-claims the
 *  turn the land enters and nothing after it (the safe direction).
 *  CEILING: a gate that is anything else (counters on the card, a graveyard count, a game state, "a land named wastes") is `unknown`, which every consumer treats as unmet. */
import type { ManaGate } from "../schema.js";

const COUNT: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
/** "you control a dragon", "you control three or more artifacts", "you control a plains or a swamp". */
const CONTROL = /^you control (?:(an?)|(\w+) or more) (.+)$/;
const SAME_NAME = /^you control (?:(an?)|(\w+) or more) lands with the same name$/;
const BASIC = /^(?:this land entered this turn or if )?you control a basic land$/;
const POWER = /^you control a creature with power (\d+) or greater$/;
/** "you control an urza's mine and an urza's tower" -- two named lands; the subtype is printed with a hyphen ("urza's power-plant"). */
const TRON = /^you control (?:an?|the) (.{1,40}?) and (?:an?|the) (.{1,40})$/;

const singular = (w: string): string => (w.endsWith("s") && !w.endsWith("ss") && w !== "plains" ? w.slice(0, -1) : w);

export function parseGate(raw: string): ManaGate {
  const text = raw.trim().toLowerCase();
  const unknown: ManaGate = { kind: "unknown", text };
  if (text === "speed 4") return { kind: "speed", n: 4, text };
  if (text === "you have the initiative") return { kind: "initiative", text };
  if (BASIC.test(text)) return { kind: "control", need: 1, nouns: ["land"], basic: true, text };
  const power = POWER.exec(text);
  if (power) return { kind: "control", need: 1, nouns: ["creature"], minPower: Number(power[1]), text };
  const same = SAME_NAME.exec(text);
  if (same) {
    const need = same[1] ? 1 : COUNT[same[2]!];
    return need === undefined ? unknown : { kind: "same-name", need, text };
  }
  const m = CONTROL.exec(text);
  if (m) {
    const need = m[1] ? 1 : COUNT[m[2]!];
    const phrase = m[3]!;
    if (need !== undefined && !/ and /.test(phrase)) {
      const nouns = phrase.split(/ or (?:an? )?/).map((w) => w.replace(/^an? /, "").trim()).map((w) => (m[1] ? w : singular(w)));
      if (nouns.every((w) => w !== "" && !/\s/.test(w))) return { kind: "control", need, nouns, text };
    }
  }
  const tron = TRON.exec(text);
  if (tron) return { kind: "tron", names: [tron[1]!.trim(), tron[2]!.trim()], text };
  return unknown;
}
