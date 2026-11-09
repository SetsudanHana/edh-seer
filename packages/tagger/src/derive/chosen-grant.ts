import type { ClauseRecord } from "../canonicalize.js";

/** "<RECIPIENT> IS / ARE THE CHOSEN TYPE" IS A TYPE-GRANT (#1570). Thirteen cards print it (Metallic Mimic, Roaming Throne, Adaptive Automaton, Titan of Littjara, Multiversal Passage, Thran Portal; Conspiracy, Rukarumel, Lifecraft Engine,
 *  Ashes of the Fallen, Realmwright; the Auras Convincing Mirage and Phantasmal Terrain; Leyline of Transformation, Arcane Adaptation and Xenograft already read), and the stored model answer for the sentence is `other`, `animate`, a keyword-looking
 *  `grant-ability`, or `none` with no object at all, none of which derives a type-grant. The sentence is read from the clause's printed text and the clause's actions are replaced by the one `grant-ability` the grammar would have read, so the type-grant path
 *  (recipient, `grantsType`, class rules) sees it as it sees "are Slivers in addition to their other types".
 *  Linear string reads only. CEILING: exactly "<recipient> is/are/becomes/have/has [also] [the] chosen [creature|land|basic land] type" as the sentence's predicate, with a recipient of at most 12 words that holds no comma, colon, "if", "target" or "reveal" (A Killer Among Us's "if target
 *  attacking creature token is the chosen type" is a condition, not a grant; Celestial Reunion's likewise). A clause with any other action than the vague ones is left as stored. */
const VAGUE = new Set(["other", "none", "animate", "grant-ability"]);
const VERBS = new Set(["is", "are", "become", "becomes", "have", "has"]);

/** The sentence of `text` that hands the chosen type over, or undefined. */
export function chosenGrantSentence(text: string): string | undefined {
  for (const raw of text.split(/(?<=\.)\s+|\n/)) {
    const sentence = raw.trim().replace(/\.$/, "");
    const words = sentence.split(" ");
    for (let i = 1; i < words.length && i <= 12; i++) {
      if (!VERBS.has(words[i]!.toLowerCase())) continue;
      let j = i + 1;
      if (words[j]?.toLowerCase() === "also") j++;
      if (words[j]?.toLowerCase() === "the") j++;
      if (words[j]?.toLowerCase() !== "chosen") continue;
      j++;
      if (words[j]?.toLowerCase() === "basic") j++;
      if (words[j]?.toLowerCase() === "creature" || words[j]?.toLowerCase() === "land") j++;
      if (words[j]?.toLowerCase() !== "type") continue;
      const recipient = words.slice(0, i).join(" ").toLowerCase();
      if (/[,:]/.test(recipient) || / (?:if|target|reveal)\b|^(?:if|reveal) /.test(recipient)) continue;
      return sentence;
    }
  }
  return undefined;
}

export function withChosenTypeGrant(clause: ClauseRecord, text: string | undefined): ClauseRecord {
  if (text === undefined) return clause;
  const actions = clause.actions ?? [];
  if (actions.length === 0 || !actions.every((a) => VAGUE.has(a.verb))) return clause;
  const sentence = chosenGrantSentence(text);
  if (sentence === undefined) return clause;
  return { ...clause, actions: [{ verb: "grant-ability", object: sentence, fromZone: null, toZone: null, amount: null, optional: false }] };
}
