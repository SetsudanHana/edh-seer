/** CR 615 PREVENTION AND THE CR 614 DAMAGE REPLACEMENTS THAT DO NOT MULTIPLY (#1469). Pure readers over the printed clause; `effect-kind.ts` asks "which kind" and `derive.ts` copies the fields onto the ability.
 *
 *  Two kinds, both FACT kinds in the matcher (edges.ts `FACT_KINDS`): `prevention` (CR 615.1a: an effect that uses the word "prevent") and `damage-change` (a CR 614 replacement of damage that reduces,
 *  halves, caps, fixes, raises or REDIRECTS it, `Effect.damageChange`). A redirect is a replacement, not a prevention (CR 614.9), so a `prevent` action whose clause says "is dealt to X instead" reads
 *  as `damage-change` / `redirected`, whichever verb the store filed it under.
 *
 *  Every reader is a WHITELIST and works by `indexOf` / `slice`, never a lazy regex over card text (CodeQL js/polynomial-redos). A word it does not know leaves the FIELD unset: the KIND is read off the
 *  verb alone, the fields only where the printed sentence states them. */
import type { DamageChange } from "../schema.js";

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/** "5" / "five" -> 5, "x" -> "x", anything else undefined. */
function amountWord(w: string): number | "x" | undefined {
  if (w === "x") return "x";
  if (/^\d{1,3}$/.test(w)) return Number(w);
  return NUMBER_WORDS[w];
}

/** The sentence of `text` that holds index `at` (sentences end at ". ", a line break or the end; an activated cost ends at ": "). */
function sentenceAt(text: string, at: number): string {
  let start = 0;
  for (const sep of [". ", "\n", ": "]) start = Math.max(start, text.lastIndexOf(sep, at) < 0 ? 0 : text.lastIndexOf(sep, at) + sep.length);
  let end = text.length;
  for (const sep of [". ", "\n"]) { const i = text.indexOf(sep, at); if (i >= 0) end = Math.min(end, i); }
  return text.slice(start, end).replace(/\.$/, "").trim();
}

/** The text of `s` from the first of `markers` (earliest index) onward, with the marker removed; undefined when none is there. */
function afterFirst(s: string, markers: readonly string[]): string | undefined {
  let best = -1, len = 0;
  for (const m of markers) {
    const i = s.indexOf(m);
    if (i >= 0 && (best < 0 || i < best)) { best = i; len = m.length; }
  }
  return best < 0 ? undefined : s.slice(best + len);
}

/** `phrase` cut at the first of `stops` (earliest index). */
function cutAtFirst(phrase: string, stops: readonly string[]): string {
  let end = phrase.length;
  for (const m of stops) { const i = phrase.indexOf(m); if (i >= 0 && i < end) end = i; }
  return phrase.slice(0, end).trim();
}

const RECIPIENT_STOPS = [" this turn", " this combat", " by ", " from ", ",", " until ", " instead", " where ", " if ", " unless ", " and dealt by", " that would be dealt", " would be dealt", " is dealt", " are dealt", " during", " while", " it deals", " that source deals"];
const RECIPIENT_MARKERS = ["dealt to ", "would deal to ", "deal damage to ", "deal combat damage to ", "deal noncombat damage to ", "deal non-combat damage to ", "damage to "];

/** WHO THE DAMAGE WOULD HURT, as printed: "you", "creatures you control", "target creature", "this creature", "any target". Undefined when the sentence names no recipient ("all combat damage that would be dealt
 *  this turn"). The phrase is not read here; `derive.ts` parses it. */
export function damageRecipientPhrase(sentence: string): string | undefined {
  const s = sentence.replace(" this turn to ", " to ").replace(" this combat to ", " to ");
  const tail = afterFirst(s, RECIPIENT_MARKERS);
  if (tail === undefined) return undefined;
  const phrase = cutAtFirst(tail, RECIPIENT_STOPS);
  // CEILING: a recipient LIST ("you and/or permanents you control", "target creature, planeswalker, or battle") names no single class and stays unset, as does a pronoun ("that creature", "those permanents").
  if (phrase === "" || phrase.includes("and/or") || /^(?:that|those|it|them|they)\b/.test(phrase) || listContinues(tail.slice(phrase.length))) return undefined;
  return phrase;
}

/** True when the text right after a recipient's cut point goes on listing recipients: ", or X", ", and X", ", X, or Y". */
function listContinues(rest: string): boolean {
  if (!rest.startsWith(",")) return false;
  const tail = rest.slice(1).trimStart();
  if (tail.startsWith("or ") || tail.startsWith("and ")) return true;
  const next = tail.indexOf(",");
  const item = next >= 0 ? tail.slice(next + 1).trimStart() : "";
  return item.startsWith("or ") || item.startsWith("and ");
}

const DEALER_STOPS = [" this turn", " this combat", ",", " until ", " instead", " to ", " would deal", " where "];
const DEALER_LEADS = ["the next time ", "all combat damage ", "all noncombat damage ", "all non-combat damage ", "all damage ", "the next damage ", "the next combat damage ", "damage ", "if ", "whenever ", "that would be dealt to you "];

/** THE SOURCE THE DAMAGE COMES FROM, as printed: "a red source of your choice", "creatures your opponents control", "enchanted creature". "Of your choice" and "of the chosen color" are dropped. A bare "a source" is
 *  no class and returns undefined, as does anything the whitelist of shapes below does not know. */
export function damageDealerPhrase(sentence: string): string | undefined {
  let phrase: string | undefined;
  // The damage's own frame ends at the first comma after the word "damage": a " from " or " by " after it belongs to another clause (Ugin's Conjurant's "remove counters from it").
  const dmg = sentence.indexOf("damage");
  const comma = dmg < 0 ? -1 : sentence.indexOf(",", dmg);
  const within = (i: number) => i >= 0 && (comma < 0 || i < comma);
  const byAt = sentence.indexOf(" by ");
  const fromAt = sentence.indexOf(" from ");
  const by = within(byAt) ? byAt : -1;
  const from = within(fromAt) ? fromAt : -1;
  const would = sentence.indexOf(" would deal");
  if (by >= 0 && sentence.indexOf("dealt") >= 0 && sentence.indexOf("dealt") < by) phrase = cutAtFirst(sentence.slice(by + 4), DEALER_STOPS.filter((x) => x !== " to "));
  else if (from >= 0) phrase = cutAtFirst(sentence.slice(from + 6), DEALER_STOPS);
  else if (would > 0) {
    const left = sentence.slice(0, would);
    let at = 0;
    for (const lead of DEALER_LEADS) { const i = left.lastIndexOf(lead); if (i >= 0) at = Math.max(at, i + lead.length); }
    phrase = left.slice(at).trim();
  }
  if (phrase === undefined) return undefined;
  phrase = phrase.replace(/ of your choice$/, "").replace(/ of the chosen (?:color|type)$/, "").trim();
  if (phrase === "" || phrase === "a source" || phrase === "any source" || phrase === "that damage" || phrase === "it") return undefined;
  if (phrase.includes(" and ") || phrase.includes(" or ") || phrase.includes(" with ")) return undefined;
  // A pronoun names no class ("that creature", "that source", "it"): unset, never a wildcard class.
  if (/^(?:that|those|it|them|they)\b/.test(phrase)) return undefined;
  return phrase;
}

/** CR 615.7 / 615.8 / 615.1a: HOW MUCH is prevented. "all" (also "that damage": all of the replaced event); a number or "x" for a shield ("the next 3 damage", "prevent 1 of that damage"); "next-instance" for the next
 *  time a source deals damage, whatever the amount (CR 615.8). Undefined for every phrase this does not know.
 *  CEILING: "all but N of that damage" (Forcefield, Temple Altisaur, Hyperion) and "half that damage" (Dark Sphere, Gisela, Blade of Goldnight) leave `amount` unset: the kind is read, the number is not. */
export type PreventedAmount = "all" | "next-instance" | number | "x";

export interface PreventionRead {
  /** The damage prevented: all of it, only combat damage, only noncombat damage. */
  damage: "any" | "combat" | "noncombat";
  amount?: PreventedAmount;
  /** "this turn" / "this combat" / "until end of turn". A static prevention has none printed; `derive.ts` fills `continuous`. */
  duration?: "this-turn";
  /** The recipient phrase ("you", "creatures you control"), parsed by `derive.ts`. */
  recipient?: string;
  /** The source phrase ("a red source", "creatures your opponents control"), parsed by `derive.ts`. */
  dealer?: string;
}

/** The prevention a printed clause states (CR 615.1a: the word "prevent"), or undefined when it holds no prevention. "Can't be prevented" is no prevention.
 *  CEILING: only the FIRST prevention sentence of a clause is read (Desperate Gambit, Spirit Link-style clauses with two); a recipient or source that is a list ("you and/or permanents you control", "to and dealt by this creature") stays unset. */
/** Drop a run of `.`, `,` or `;` that ends a word (followed by a space or the end), in one linear pass.
 *  The regex form `/[.,;]+(?= |$)/g` rescans a long comma run from every start (CodeQL js/polynomial-redos). */
function dropTrailingPunctuation(text: string): string {
  let out = "";
  let run = "";
  for (const ch of text) {
    if (ch === "." || ch === "," || ch === ";") { run += ch; continue; }
    if (ch !== " ") out += run;
    run = "";
    out += ch;
  }
  return out;
}

export function preventionOf(clauseText: string): PreventionRead | undefined {
  const lower = clauseText.toLowerCase().replace(/’/g, "'");
  let at = -1;
  for (let from = 0; ;) {
    const i = lower.indexOf("prevent", from);
    if (i < 0) break;
    const next = lower.slice(i, i + 12);
    const before = lower.slice(Math.max(0, i - 8), i);
    if (!/^prevented\b/.test(next) && !/^preventing\b/.test(next) && !before.includes("be ")) { at = i; break; }
    from = i + 7;
  }
  if (at < 0) return undefined;
  const sentence = sentenceAt(lower, at);
  // The text from the verb on says how much; the whole sentence says who and when ("If damage would be dealt to Khârn, prevent that damage").
  const rest = dropTrailingPunctuation(lower.slice(at + "prevent".length).trimStart());
  const words = rest.split(" ");
  let amount: PreventedAmount | undefined;
  if (words[0] === "all" && words[1] === "but") amount = undefined;
  else if (words[0] === "all") amount = "all";
  else if (words[0] === "that" && words[1] === "damage") amount = sentence.includes("the next time ") ? "next-instance" : "all";
  else if (words[0] === "the" && words[1] === "next") {
    const n = amountWord(words[2] ?? "");
    if (n !== undefined && (words[3] === "damage" || (words[3] === "combat" && words[4] === "damage"))) amount = n;
    else if (words[2] === "damage" || words[2] === "time" || words[2] === "instance" || (words[2] === "combat" && words[3] === "damage")) amount = "next-instance";
  } else {
    const n = amountWord(words[0] ?? "");
    if (n !== undefined && (words[1] === "damage" || (words[1] === "of" && (words[2] === "that" || words[2] === "the") && words[3] === "damage"))) amount = n;
  }
  const damage: PreventionRead["damage"] = /\bnon-?combat damage\b/.test(sentence) ? "noncombat" : /\bcombat damage\b/.test(sentence) ? "combat" : "any";
  const read: PreventionRead = { damage };
  if (amount !== undefined) read.amount = amount;
  if (/\bthis turn\b|\bthis combat\b|\buntil end of turn\b/.test(sentence)) read.duration = "this-turn";
  // "dealt to and dealt by X" names X on both sides: left unset (CEILING above).
  if (sentence.includes("to and dealt by")) return read;
  const recipient = damageRecipientPhrase(sentence);
  if (recipient !== undefined) read.recipient = recipient;
  const dealer = damageDealerPhrase(sentence);
  if (dealer !== undefined) read.dealer = dealer;
  return read;
}

/** True when the printed clause REDIRECTS damage (CR 614.9): "that damage is dealt to any target instead", "it deals that damage to you instead". "Deals that much damage to you AND ... deals that much to that source's
 *  controller" (Eye for an Eye) keeps the damage on its recipient and is no redirect. */
export function redirectsDamage(clauseText: string): boolean {
  const lower = clauseText.toLowerCase().replace(/’/g, "'");
  for (const sentence of lower.split(/\. |\n/)) {
    if (!sentence.includes("instead") && !sentence.includes("is dealt to")) continue;
    if (!sentence.includes("would deal") && !sentence.includes("would be dealt") && !sentence.includes("prevent")) continue;
    if (sentence.includes("can't be prevented or dealt instead")) continue;
    if (sentence.includes(" and ") && sentence.includes("deals that much damage to you")) continue;
    if (sentence.includes("deals that damage to ") || sentence.includes("that damage is dealt to ") || sentence.includes(" is dealt to ") || sentence.includes(" are dealt to ")) {
      return sentence.includes("instead");
    }
  }
  return false;
}

/** The dealt number a replacement fixes: "it deals 2 damage ... instead" -> 2. Undefined when the sentence states none. */
function dealsNumber(sentence: string): number | undefined {
  for (const lead of ["deals ", "deal "]) {
    const i = sentence.lastIndexOf(lead);
    if (i < 0) continue;
    const w = sentence.slice(i + lead.length).split(" ");
    const n = amountWord(w[0] ?? "");
    if (typeof n === "number" && (w[1] === "damage" || w[1] === "noncombat" || w[1] === "combat")) return n;
  }
  return undefined;
}

/** WHAT A DAMAGE REPLACEMENT THAT DOES NOT MULTIPLY DOES TO THE DAMAGE (#1469, CR 614): "minus N" is `reduced` (Benevolent Unicorn, Lashknife Barrier); "half that damage" `halved` (Ghosts of the Innocent);
 *  "N or more damage ... deals M instead" is `capped` when M is below N (Divine Presence, Forethought Amulet) and `fixed` otherwise (Equal Treatment); "exactly N ... deals M" is `increased` when M is above N (Mijo);
 *  "an amount less than ... deals damage equal to ... instead" is `increased` (Ojer Axonil); "deals N damage instead" with no threshold is `fixed`; a redirect is `redirected` (Harsh Judgment, Goblin Psychopath).
 *  Undefined when the clause states none of these (a multiplier is `damageChangeOf`'s; a mill or counters are #1465's).
 *  CEILING: a clause stating two changes reads the first in the order below (redirect last: a redirect that also says "half" is not a printed card). */
export function damageReplacementOf(clauseText: string): DamageChange | undefined {
  const lower = clauseText.toLowerCase().replace(/’/g, "'");
  if (!lower.includes("instead")) return undefined;
  if (/\bminus (?:\d+|one|two|three|four|five|x)\b/.test(lower)) return "reduced";
  if (/\bhalf (?:that|the) damage\b/.test(lower) || (lower.includes("damage") && lower.includes(" is halved"))) return "halved";
  const sentence = lower.split(/\. |\n/).find((x) => x.includes("would deal") && x.includes("instead")) ?? "";
  const dealt = dealsNumber(sentence);
  if (dealt !== undefined) {
    const more = sentence.indexOf(" or more damage");
    if (more > 0) {
      const t = amountWord(sentence.slice(sentence.lastIndexOf(" ", more - 1) + 1, more));
      if (typeof t === "number") return dealt < t ? "capped" : "fixed";
    }
    const exactly = sentence.indexOf("exactly ");
    if (exactly >= 0) {
      const t = amountWord(sentence.slice(exactly + "exactly ".length).split(" ")[0] ?? "");
      if (typeof t === "number") return dealt > t ? "increased" : "reduced";
    }
    return "fixed";
  }
  if (sentence.includes("less than") && sentence.includes("deals damage equal to")) return "increased";
  if (redirectsDamage(clauseText)) return "redirected";
  return undefined;
}

/** WHO THE REPLACED DAMAGE WOULD HURT in a damage replacement, read from the "would deal ... damage to X" frame only (never the "instead" half, whose recipient is the NEW one: Goblin Psychopath's "it deals that
 *  damage to you instead" is no recipient of the replaced damage). "a permanent or player" is a list, which `derive.ts` leaves unnamed. */
export function replacedDamageRecipient(clauseText: string): string | undefined {
  const lower = clauseText.toLowerCase().replace(/\u2019/g, "'");
  const sentence = lower.split(/\. |\n/).find((x) => x.includes("instead") && (x.includes("would deal") || x.includes("would be dealt")));
  if (sentence === undefined) return undefined;
  const at = Math.min(...["would deal", "would be dealt"].map((m) => sentence.indexOf(m)).filter((i) => i >= 0));
  const comma = sentence.indexOf(",", at);
  const head = sentence.slice(at, comma < 0 ? undefined : comma);
  const phrase = damageRecipientPhrase(head);
  // A recipient list that runs past the comma ("to a player, a planeswalker, or a battle") is unset, not cut at its first item.
  if (phrase !== undefined && comma >= 0 && head.trimEnd().endsWith(phrase) && listContinues(sentence.slice(comma))) return undefined;
  return phrase;
}
