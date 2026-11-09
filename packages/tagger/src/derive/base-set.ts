import type { ClauseRecord } from "../canonicalize.js";

/** THE MODEL'S `other` FOR "<class> have base power and toughness N/M and are <Type> in addition to their other types" (#1572; Kudo, King Among Bears). The grammar reads the sentence as a `modify-pt` of the class and a `grant-ability`
 *  of the type; the stored model answer is the verb `other` with the whole sentence as its object, which derives nothing and left the card to switch between the two readings. Split it the way the grammar reads it, so both derive alike.
 *  Linear string reads only. CEILING: exactly this sentence shape, from the clause's printed text; any other `other` stays as the model stored it. */
export function withBaseSetSplit(clause: ClauseRecord, text: string | undefined): ClauseRecord {
  const actions = clause.actions ?? [];
  if (text === undefined || actions.length !== 1 || actions[0]!.verb !== "other") return clause;
  const sentence = text.trim().replace(/\.$/, "");
  const MID = " have base power and toughness ";
  const at = sentence.indexOf(MID);
  if (at < 1) return clause;
  const subject = sentence.slice(0, at);
  const rest = sentence.slice(at + MID.length);
  const AND = " and are ";
  const split = rest.indexOf(AND);
  const value = split < 0 ? "" : rest.slice(0, split);
  const slash = value.indexOf("/");
  const digits = (s: string): boolean => s.length > 0 && s.length <= 2 && [...s].every((ch) => ch >= "0" && ch <= "9");
  if (slash < 1 || !digits(value.slice(0, slash)) || !digits(value.slice(slash + 1))) return clause;
  const granted = rest.slice(split + AND.length);
  if (!granted.endsWith(" in addition to their other types") && !granted.endsWith(" in addition to their other creature types")) return clause;
  const lower = subject.toLowerCase();
  return {
    ...clause,
    actions: [
      { ...actions[0]!, verb: "modify-pt", object: lower, amount: value },
      { ...actions[0]!, verb: "grant-ability", object: `${lower} are ${granted}`, amount: null },
    ],
  };
}
