/** A KEYWORD GRANT WHOSE RECIPIENT IS THE CARD ITSELF (#1266): "This creature gains indestructible until end of turn" (Adanto Vanguard), "Dragonlord Ojutai has hexproof as long as it's
 *  untapped", "Kogla gains indestructible ...", and the "It gains ..." that follows a sentence naming the card and no target (Hungering Puppetbeast). Derive drops the recipient of an unbounded
 *  grant on purpose (`effectSubject`: a subject on a grant forms edges), so "this creature gains" and "creatures you control gain" derived the same subject-less `keyword-grant`, and the
 *  protection ROLE read the difference off printed text (`rules.ts` `withoutSelfGrants`, #1289). This is that reader, moved to derive and run per clause: see `Ability.grantsSelf`.
 *
 *  A SINGULAR verb is the cue the recipient is one object ("this creature and other creatures you control gain" is plural: a grant to others too). True only when the clause has at least one
 *  sentence that hands over a keyword of `grants` and EVERY such sentence is the card's own.
 *  CEILING: a sentence inside a quoted ability is never the card's own (the quote's "this creature" is the grantee), so a quoted grant to the card itself ("this creature gains '...'") is not
 *  marked; a name's short form is its text before the comma, or its first word when no word of it is lowercase ("Zurgo"); "they" is not read (its verb is plural, which the reader refuses); "<card> enters as a copy" is the card, not another object (The Fourteenth Doctor); a pronoun is resolved (the ability's own cost counts as words before it: the grammar's clause text has none) only by "the words before it name the card and no target, and the sentence before it made no other object" (create, copy, return, exile, put onto the battlefield), so "Whenever this creature blocks a creature, it gains ..." is the card and "Target creature ...
 *  This creature fights it. It gains ..." is not read; the antecedent is the sentence before the pronoun and its own sentence's head only. */
const THIS_CARD = "this (?:creature|artifact|permanent|vehicle|enchantment|land|planeswalker)";
/** A condition, a duration or a trigger before the recipient: "As long as your opponents control no creatures, this creature has ..." (Erebos's Titan), "Whenever this creature attacks, it gains ...". */
const HEAD = /^(?:until end of turn|as long as\b[^,]*|when(?:ever)?\b[^,]*|at\b[^,]*|if\b[^,]*|during\b[^,]*),\s*/i;
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The first word of a name with no comma ("Zurgo Helmsmasher" -> "Zurgo"), the short name the printed text uses. Only a name whose every word is capitalised ("Sword of Fire" is no person) and that does not open on "The". */
const shortName = (face: string): string => {
  const words = face.split(/\s+/);
  return face.includes(",") || words.length < 2 || words[0] === "The" || words.some((w) => !/^[A-Z]/.test(w)) || !/^[A-Z][a-z']{3,}$/.test(words[0]!) ? "" : words[0]!;
};

export function grantsSelfOf(clauseText: string, grants: readonly string[], cardName: string | undefined, cost?: string): boolean {
  if (grants.length === 0) return false;
  const names = (cardName ?? "").split(" // ").flatMap((face) => [face, face.split(",")[0]!, shortName(face)]).map((n) => n.trim()).filter((n) => n.length > 0).map(escapeRe);
  const subject = `(?:${[THIS_CARD, ...names].join("|")})`;
  const direct = new RegExp(`^${subject}\\b(?:[^.]{0,60}?\\band)?\\s+(?:gains|gets|has)\\b`, "i");
  const named = new RegExp(`\\b${subject}\\b`, "i");
  // A sentence that created, copied, returned, exiled or put onto the battlefield something that is not the card: its "It" is that object, though the sentence names the card and no target
  // (Mimic Vat "Create a token that's a copy ... It gains haste", Hellkite Courser "put a commander ... onto the battlefield. It gains haste", The Eleventh Doctor "exile a card ... it gains suspend").
  const notSelfObject = `(?!(?:it|them|${subject})\\b)`;
  const makesAnother = new RegExp(`\\bcreates?\\b|(?<!${subject}\\s+enters?\\s+as\\s+an?\\s+)\\bcop(?:y|ies)\\b|\\b(?:returns?|exiles?)\\s+${notSelfObject}|\\bputs?\\s+${notSelfObject}[^.]*\\bonto the battlefield`, "i");
  const keywords = grants.map((g) => g.toLowerCase());
  let seen = 0;
  for (const line of clauseText.split("\n")) {
    let before = "";
    // What the sentence before said WITHOUT its cost: "Return a land you control to its owner's hand: Untap this creature. It gains hexproof" untapped the card (Trench Behemoth).
    let beforeBody = "";
    let quotes = 0;
    for (const sentence of line.split(/(?<=[.!?])\s+/)) {
      // INSIDE A QUOTED ABILITY "this creature" and "It" are the GRANTEE (Agent of the Shadow Thieves), never the card: such a sentence starts, or lies, inside an open quote.
      const quoted = quotes % 2 === 1 || sentence.includes('"');
      quotes += (sentence.match(/"/g) ?? []).length;
      // A cost ("{1}{G}: ") or an ability word ("Rosarius — ", "Landfall — ") before the sentence proper.
      const afterCost = sentence.replace(/^[^:"]*:\s*/, "").replace(/^[A-Z][A-Za-z' ]{0,30} \u2014 /, "");
      // Two heads at most ("Whenever this creature attacks, if ..., it gains").
      const body = afterCost.replace(HEAD, "").replace(HEAD, "");
      // The cost is the antecedent only for the clause's first sentence: after an earlier sentence the "It" belongs to that sentence (Smelt-Ward Ignus: "Untap that creature. It gains haste").
      const antecedent = `${before === "" ? cost ?? "" : ""} ${before} ${sentence.slice(0, sentence.length - afterCost.length)} ${afterCost.slice(0, afterCost.length - body.length)}`;
      // The antecedent of "It" is the sentence just before it and this sentence's own head, no further back: Strefan's "... you may put a Vampire card from your hand onto the battlefield tapped and
      // attacking. It gains indestructible" is the Vampire, though the clause opens "Whenever Strefan attacks".
      const earlier = beforeBody;
      before = sentence;
      beforeBody = afterCost;
      // The sentence hands over one of THIS ability's keywords: a grant verb, then the keyword.
      const verbAt = body.search(/\b(?:gains?|has|have)\b/i);
      const tail = verbAt < 0 ? "" : body.slice(verbAt).toLowerCase();
      if (verbAt < 0 || !keywords.some((k) => tail.includes(k))) continue;
      // A parenthesised reminder explains a keyword and hands over nothing ("(It can't be blocked ... as long as it has ...)").
      if (sentence.trimStart().startsWith("(")) continue;
      seen++;
      const pronoun = /^(?:it|he|she)\s+(?:gains|gets|has)\b/i.test(body);
      const self = !quoted
        && (direct.test(body) || (pronoun && named.test(antecedent) && !/\btarget\b/i.test(antecedent) && !makesAnother.test(earlier)))
        && !/\b(?:gain|get|have)\b/i.test(body)
        && !/\b(?:gains|gets|has)\b[^.]*?\band\s+(?:target|each|all|other|another|creatures?|permanents?|equipped|enchanted|up to)\b/i.test(body);
      if (!self) return false;
    }
  }
  return seen > 0;
}
