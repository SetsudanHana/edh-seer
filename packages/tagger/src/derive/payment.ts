/** WHAT AN ACTIVATION COSTS, STRUCTURED (#806). `Ability.cost` stays the verbatim string; this is
 *  its reading, so a loop can check that each iteration is paid by what the loop itself makes
 *  (owner's rules for #726, 2026-09-05). The #726 research parsed every one of these out of the raw
 *  string, and holding loops to "costs paid, mana and life balanced" is what took false loops in
 *  combo-free decks from about 1,000,000 to 17.
 *
 *  The cost is everything before the colon (CR 602.1a); its parts are split on the commas. A part this
 *  cannot read goes to `other` VERBATIM: a cost with an unread part is not free, and dropping it
 *  would say it was.
 *
 *  A SACRIFICE, A TAP AND A COUNTER REMOVAL IN A COST ARE ALWAYS YOUR OWN (CR 701.21a: you sacrifice
 *  only permanents you control), so a class there is `control: "you"`. The count rides beside the
 *  subject as `amount` ("1", "2", "X", "any", "all"), never as the subject's `scope`. */
import type { CostObject, Payment } from "../schema.js";
import { parseSubject } from "./subject.js";
import { isSelfSubject } from "./self-reference.js";

const WORDS: Record<string, string> = { a: "1", an: "1", another: "1", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", x: "X" };
/** The count a cost object opens with, and the rest of it. */
function counted(text: string): { amount: string; rest: string } {
  const t = text.trim();
  if (/^any number of\b/i.test(t)) return { amount: "any", rest: t.replace(/^any number of\s+/i, "") };
  const m = /^(\d+|a|an|another|one|two|three|four|five|six|seven|x)\b\s*/i.exec(t);
  if (!m) return { amount: "1", rest: t };
  // "another" is a count AND a narrowing: keep it on the subject.
  return { amount: /^\d+$/.test(m[1]!) ? m[1]! : WORDS[m[1]!.toLowerCase()]!, rest: m[1]!.toLowerCase() === "another" ? t : t.slice(m[0].length) };
}
const SELF_OBJECT = /^(?:this|~|it)\b|^this (?:card|creature|artifact|enchantment|land|permanent|planeswalker|equipment|vehicle|aura)\b/i;
/** "remove <head> counter(s) from <tail>" split as `/^remove (.+?) counters? from (.+)$/i` would split it, without the
 *  regex: two quantifiers around a literal are what CodeQL's js/polynomial-redos flags (#1303), so the FIRST
 *  " counter(s) from " after a non-empty head is found by a fixed, quantifier-free search. `.` never matched a
 *  newline, so a part holding one never matched; an empty tail never matched either. Shaped like a RegExp
 *  match ([whole, head, tail]) so the caller reads it unchanged. */
function removeCounterParts(part: string): [string, string, string] | null {
  if (part.slice(0, 7).toLowerCase() !== "remove " || part.includes("\n")) return null;
  const sep = / counters? from /gi;
  sep.lastIndex = 8;
  const hit = sep.exec(part);
  if (!hit) return null;
  const tail = part.slice(hit.index + hit[0].length);
  return tail ? [part, part.slice(7, hit.index), tail] : null;
}
function objectOf(text: string, cardName: string | undefined, zone?: string): CostObject {
  const { amount, rest } = counted(text);
  const body = rest.replace(/ from your (graveyard|hand)\b/i, "").trim();
  if (SELF_OBJECT.test(body) || isSelfSubject(body, cardName)) return { amount, subject: zone ? { self: true, zone } : { self: true } };
  const { scope: _s, fromZone: _f, ...subject } = parseSubject(body);
  return { amount, subject: { ...subject, control: "you", ...(zone ? { zone } : {}) } };
}
const push = <K extends keyof Payment>(p: Payment, k: K, v: NonNullable<Payment[K]> extends (infer T)[] ? T : never) =>
  { ((p[k] as unknown[] | undefined) ?? ((p as Record<string, unknown[]>)[k] = [])).push(v); };

export function paymentOf(cost: string | undefined, cardName?: string): Payment | undefined {
  if (!cost?.trim()) return undefined;
  const p: Payment = {};
  // A LIST INSIDE ONE PART: "Sacrifice a white creature, a blue creature, and a black creature"
  // splits into three pieces, and the second and third carry no verb. They take the previous one's.
  let verb = "";
  for (const raw of cost.split(/,\s*/)) {
    let part = raw.trim();
    if (!part) continue;
    const bare = /^(?:and |or )?(?:a|an|another|\d+|this)\b/i.test(part) && !/^\d+$/.test(part);
    if (bare && verb) part = `${verb} ${part.replace(/^(?:and|or) /i, "")}`;
    verb = /^(sacrifice|discard|exile|tap)\b/i.exec(part)?.[1] ?? "";
    let m: RegExpExecArray | null;
    let rc: [string, string, string] | null;
    if (/^(?:\{[^{}]+\})+$/.test(part)) {
      const symbols = part.match(/\{[^{}]+\}/g)!;
      if (symbols.some((s) => /^\{E\}$/i.test(s))) { push(p, "other", part); continue; }
      if (symbols.some((s) => /^\{T\}$/i.test(s))) p.tap = true;
      if (symbols.some((s) => /^\{Q\}$/i.test(s))) p.untap = true;
      const mana = symbols.filter((s) => !/^\{[TQ]\}$/i.test(s)).join("");
      if (mana) p.mana = (p.mana ?? "") + mana;
    } else if ((m = /^([+−-])\s*(\d+|X)$/i.exec(part))) p.loyalty = `${m[1] === "+" ? "+" : "-"}${m[2]!.toUpperCase()}`;
    else if (/^0$/.test(part)) p.loyalty = "0";
    else if ((m = /^pay (\d+|X) life$/i.exec(part))) p.life = m[1]!.toUpperCase();
    else if ((m = /^sacrifice (.+)$/i.exec(part))) push(p, "sacrifice", objectOf(m[1]!, cardName));
    else if ((m = /^discard (.+)$/i.exec(part))) {
      const what = m[1]!;
      if (/^your hand$/i.test(what)) push(p, "discard", { amount: "all", subject: { control: "you", token: null } });
      else if (SELF_OBJECT.test(what)) push(p, "discard", { amount: "1", subject: { self: true, zone: "hand" } });
      else {
        const { amount, rest } = counted(what);
        const { scope: _s, ...subject } = /^cards?(?: at random)?$/i.test(rest) ? { control: "you" as const, token: null } : parseSubject(rest.replace(/ at random$/i, ""));
        push(p, "discard", { amount, subject: { ...subject, control: "you" } });
      }
    } else if ((m = /^exile (.+?)(?: from your (graveyard|hand))?$/i.exec(part))) push(p, "exile", objectOf(m[1]!, cardName, m[2]?.toLowerCase()));
    else if ((m = /^tap (.+)$/i.exec(part))) push(p, "tapOther", objectOf(m[1]!.replace(/\buntapped\s+/i, ""), cardName));
    else if ((m = /^return (.+?) to (?:its|their) owner'?s'? hands?$/i.exec(part))) push(p, "returnToHand", objectOf(m[1]!, cardName));
    else if ((rc = removeCounterParts(part))) {
      // The optional kind ("+1/+1", "oil") is the LAST token of group 1 when it has two or more; split
      // in code, not in the regex, so the lazy group cannot overlap an optional one (polynomial-redos).
      const head = rc[1];
      const cut = head.lastIndexOf(" ");
      const kind = cut > 0 ? head.slice(cut + 1) : "";
      const isKind = /^(?:[+-]\d+\/[+-]\d+|\w+)$/.test(kind);
      const { amount } = counted(isKind ? head.slice(0, cut) : head);
      const obj = objectOf(`a ${rc[2]}`, cardName);
      push(p, "removeCounter", { amount, ...(isKind ? { counter: kind.toLowerCase() } : {}), subject: obj.subject });
    } else push(p, "other", part);
  }
  return Object.keys(p).length ? p : undefined;
}
