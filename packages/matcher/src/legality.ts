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

export interface LegalityFinding {
  rule: "size" | "duplicate" | "color-identity" | "commander";
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
