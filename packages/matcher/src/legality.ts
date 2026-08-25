import type { Card } from "@mtg/engine";

/** DECK LEGALITY AS A REPORT, NEVER A GATE (roadmap J4, CR 903.3 and 903.5a-d).
 *
 *  A REFUSAL IS THE WRONG FAILURE DIRECTION HERE, and that is the `cutCandidates` ruling one layer
 *  over: a partial paste is a normal thing to hand this tool. Someone testing a shell, someone
 *  pasting 40 cards to see what the engine says, someone mid-build — refusing to analyse any of them
 *  would be a worse product than reporting what is off.
 *
 *  EVERY INPUT ALREADY EXISTED AND NOT ONE WAS CHECKED. `colorIdentity` is read in exactly two
 *  places today — `answer-pool.ts` for weighting and `graph.ts` for an `IDENTITY` edge — neither of
 *  them legality. The irony worth keeping: the engine already models the EXCEPTION to 903.5b
 *  (`SubjectFilter.named`, the 13 "a deck can have any number of cards named …" cards) and never
 *  modelled the rule.
 *
 *  IT FIRES ON NOTHING IN THE CALIBRATION CORPUS, and that is recorded rather than hidden: all 71
 *  decks are exactly 100 cards, carry no duplicate nonbasic, and stay inside their commander's
 *  colour identity. Like I9's `bfz` row, this is built for the arbitrary pasted list and not for the
 *  owner's own well-built decks. */

/** CR 903.5b's own exception, printed on the card. Thirteen corpus cards say it — Dragon's Approach,
 *  Persistent Petitioners, Shadowborn Apostle, Rat Colony — and `SubjectFilter.named` already reads
 *  the same sentence for a different purpose. */
const ANY_NUMBER_NAMED = /a deck can have any number of cards named/i;

/** CR 903.3's carve-out, printed verbatim on 49 corpus cards. Will Kenrith is a Legendary
 *  PLANESWALKER and a legal commander because it says so in its own text. */
const CAN_BE_COMMANDER = /can be your commander/i;

/** CR 702.124 — WHICH PAIRS MAY LEAD A DECK TOGETHER (roadmap J12's partner half). J4 shipped a
 *  commander check that accepts a Background without ever looking at its partner, and said so in its
 *  own comment; this is that deferred half.
 *
 *  MEASURED FIRST, AND THE CR-DERIVED LIST WAS SHORT BY THREE. The roadmap named five abilities;
 *  the corpus prints SIX forms — **Partner 70 · Partner with <name> 54 · Partner—Friends forever 7 ·
 *  Partner—Character select 6 · Partner—Survivors 4 · Partner—Father & son 2**, plus Choose a
 *  Background 32 and Doctor's companion 27. So the rule reads the LABEL after the em dash and pairs
 *  any two cards printing the same one, rather than enumerating the labels — Friends forever is not
 *  special, and a seventh group printed next year works without a code change. */
const PARTNER_BARE = /(?:^|\n)Partner \(/;
/** 702.124c names the specific other card, so the pair is licensed only with THAT card. */
const PARTNER_WITH = /(?:^|\n)Partner with ([^(\n]+)/i;
/** 702.124's named groups. The captured label is the thing that must match on both cards. */
const PARTNER_LABEL = /(?:^|\n)Partner—([^(\n]+?)\s*\(/i;
const CHOOSE_BACKGROUND = /Choose a Background/i;
const DOCTORS_COMPANION = /Doctor's companion/i;

function partnerLabel(text: string): string | undefined {
  return PARTNER_LABEL.exec(text)?.[1]?.trim().toLowerCase();
}

/** Does `a` name `b`? "Partner with Kydele, Chosen of Kruphix" carries the whole printed name, so a
 *  containment test either way is enough and survives the comma every legendary name has. */
function namesPartner(a: Card, b: Card): boolean {
  const who = PARTNER_WITH.exec(a.oracleText ?? "")?.[1]?.trim().toLowerCase().replace(/\.$/, "");
  if (!who) return false;
  const other = b.name.toLowerCase();
  return who.includes(other) || other.includes(who);
}

/** The printed ability that licenses this pair, or undefined when nothing on either card does.
 *
 *  UNDER-REPORTS, exactly as `isLegalCommander` does and for the same measured reason: the naive
 *  reading of 903.3 flagged five legal decks. A pair this cannot license is REPORTED, so every
 *  licensing shape the corpus actually prints has to be here — which is why the six forms were
 *  counted before the regexes were written rather than after. */
function pairingLicense(a: Card, b: Card): string | undefined {
  const ta = a.oracleText ?? "";
  const tb = b.oracleText ?? "";
  if (PARTNER_BARE.test(ta) && PARTNER_BARE.test(tb)) return "partner";
  if (namesPartner(a, b) || namesPartner(b, a)) return "partner with";
  const la = partnerLabel(ta);
  if (la !== undefined && la === partnerLabel(tb)) return la;
  // A Background is the SECOND commander, so the licence is on the other card. Checked both ways
  // round because a decklist states no order.
  const isBg = (c: Card): boolean => (c.typeLine ?? "").toLowerCase().includes("background");
  if ((CHOOSE_BACKGROUND.test(ta) && isBg(b)) || (CHOOSE_BACKGROUND.test(tb) && isBg(a))) return "choose a background";
  // 702.124's Doctor's companion wants the OTHER to be the Doctor — a legendary creature whose type
  // line says Doctor. 17 corpus cards qualify.
  const isDoctor = (c: Card): boolean => {
    const l = (c.typeLine ?? "").toLowerCase();
    return l.includes("legendary") && l.includes("doctor");
  };
  if ((DOCTORS_COMPANION.test(ta) && isDoctor(b)) || (DOCTORS_COMPANION.test(tb) && isDoctor(a))) return "doctor's companion";
  return undefined;
}

export interface LegalityFinding {
  rule: "size" | "duplicate" | "color-identity" | "commander" | "pairing";
  /** What a reader should do about it, in their own words. */
  detail: string;
  /** The cards involved, where naming them helps. Empty for a deck-level count. */
  cards: string[];
}

/** Is this card a legal commander? CR 903.3, with the two carve-outs the bare rule omits.
 *
 *  UNDER-REPORTS ON PURPOSE. A report that cries wolf is worse than one that stays quiet: the naive
 *  reading of 903.3 flagged FIVE of the 71 decks, and all five were false — four Backgrounds
 *  (Haunted One, Feywild Visitor, Candlekeep Sage, Cultist of the Absolute) and Will Kenrith, whose
 *  own text makes it legal. That measurement is why both carve-outs are here.
 *
 *  A BACKGROUND IS ACCEPTED WITHOUT CHECKING ITS PARTNER prints "Choose a Background". The pairing
 *  is J12's question, and flagging a legal Background because this function cannot see its partner
 *  would be the same false positive one step later. */
function isLegalCommander(card: Card): boolean {
  const line = (card.typeLine ?? "").toLowerCase();
  const text = card.oracleText ?? "";
  if (CAN_BE_COMMANDER.test(text)) return true;
  if (line.includes("background")) return true;
  if (!line.includes("legendary")) return false;
  if (line.includes("creature")) return true;
  // CR 903.3 admits a Vehicle or Spacecraft only when it HAS power and toughness — the printed
  // characteristics, not what it becomes when crewed.
  return (line.includes("vehicle") || line.includes("spacecraft")) && card.power !== null && card.power !== undefined;
}

export interface LegalityInput {
  /** Every card slot, one entry per COPY — the size check counts copies, not distinct names. */
  cards: readonly Card[];
  commanders: readonly Card[];
}

/** What is off about this deck, as a list of findings. Empty means nothing was found — never
 *  "the deck is legal", because this checks four rules and the format has more. */
export function deckLegality({ cards, commanders }: LegalityInput): LegalityFinding[] {
  const out: LegalityFinding[] = [];

  // 903.5a — one hundred cards, the commander included.
  const total = cards.length;
  if (total !== 100) {
    out.push({
      rule: "size",
      detail: `${total} cards, and a Commander deck is exactly 100`,
      cards: [],
    });
  }

  // 903.5b — one of each nonbasic name, unless the card says otherwise.
  const counts = new Map<string, { n: number; card: Card }>();
  for (const c of cards) {
    const e = counts.get(c.name) ?? { n: 0, card: c };
    e.n++;
    counts.set(c.name, e);
  }
  const dups = [...counts.values()].filter((e) => e.n > 1
    && !/\bbasic\b/i.test(e.card.typeLine ?? "")
    && !ANY_NUMBER_NAMED.test(e.card.oracleText ?? ""));
  if (dups.length > 0) {
    out.push({
      rule: "duplicate",
      detail: `${dups.length} nonbasic card${dups.length === 1 ? " appears" : "s appear"} more than once`,
      cards: dups.map((e) => `${e.card.name} x${e.n}`).sort(),
    });
  }

  // 903.5c/d — every card inside the commander's colour identity. Checked only when a commander was
  // identified: with none, the identity is empty and EVERY coloured card would be flagged, which is
  // a report about the parser rather than about the deck.
  if (commanders.length > 0) {
    const identity = new Set(commanders.flatMap((c) => c.colorIdentity ?? []));
    const seen = new Set<string>();
    const off: string[] = [];
    for (const c of cards) {
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      if ((c.colorIdentity ?? []).some((x) => !identity.has(x))) off.push(c.name);
    }
    if (off.length > 0) {
      out.push({
        rule: "color-identity",
        detail: `${off.length} card${off.length === 1 ? " is" : "s are"} outside ${[...identity].sort().join("") || "colourless"}, your commander's colour identity`,
        cards: off.sort(),
      });
    }
  }

  // 702.124 — two commanders need a printed ability that pairs THEM, and three is never legal.
  //
  // BY NAME, AND THE LIVE BROWSER IS WHAT CAUGHT IT. A Moxfield export lists the commander in the
  // decklist as well as naming it, so the same card routinely arrives twice — and the tool's own
  // example deck does it. Counted as slots that reads as "two commanders", and the pair then fails
  // every licensing test because a card does not partner with itself: the panel flagged
  // "Krenko, Mob Boss · Krenko, Mob Boss" as an illegal pairing. One card is one commander.
  const distinct = [...new Map(commanders.map((c) => [c.name, c])).values()];
  if (distinct.length > 2) {
    out.push({
      rule: "pairing",
      detail: `${distinct.length} commanders, and no ability in the format lets a deck have more than two`,
      cards: distinct.map((c) => c.name).sort(),
    });
  } else if (distinct.length === 2 && pairingLicense(distinct[0], distinct[1]) === undefined) {
    out.push({
      rule: "pairing",
      detail: "these two cannot be commanders together — neither prints Partner, a Partner group, Choose a Background or Doctor's companion that names the other",
      cards: distinct.map((c) => c.name).sort(),
    });
  }

  // 903.3 — who may lead the deck.
  const bad = commanders.filter((c) => !isLegalCommander(c));
  if (bad.length > 0) {
    out.push({
      rule: "commander",
      detail: `your commander ${bad.length === 1 ? "is" : "are"} not a legendary creature, and nothing on the card says it can lead a deck`,
      cards: bad.map((c) => c.name).sort(),
    });
  }

  return out;
}
