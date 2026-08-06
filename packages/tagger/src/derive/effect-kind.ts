/** An action to one of the engine's closed 29 effect kinds, or nothing.
 *
 *  Two things make this more than a lookup. First, the origin zone is often the whole card: `exile`
 *  from a graveyard is graveyard hate, `exile` from the battlefield is removal. Second, the engine's
 *  vocabulary is payoff-centric and has NO removal kind, so `destroy` legitimately maps to nothing
 *  and reaches the graph through its `dies` emit instead. A near-miss kind is worse than null: it is
 *  consumed as if it were true. */
import type { Action } from "../canonicalize.js";
import type { EffectKind } from "../schema.js";
import { parseSubject } from "./subject.js";

/** Zone-sensitive rules, checked before the plain lookup. Order matters within this list.
 *  `from`/`to` omitted means "don't care"; `from: null` means the origin must be the verb's DEFAULT
 *  (canonicalAction nulls an unstated or `library` origin), which is how a self-mill is told apart
 *  from a card moved into a graveyard out of some other zone. */
const ZONE_RULES: { verb: string; from?: string | null; to?: string; kind: EffectKind }[] = [
  { verb: "exile", from: "graveyard", kind: "graveyard-hate" },
  { verb: "put", from: "graveyard", to: "battlefield", kind: "graveyard-recursion" },
  { verb: "return", from: "graveyard", to: "battlefield", kind: "graveyard-recursion" },
  { verb: "put", from: "graveyard", to: "hand", kind: "graveyard-recursion" },
  { verb: "return", from: "graveyard", to: "hand", kind: "graveyard-recursion" },
  // Muldrotha templates recursion as permission to PLAY/CAST out of the graveyard rather than to
  // move a card, so keying only on put/return lost the whole card.
  { verb: "play", from: "graveyard", kind: "graveyard-recursion" },
  { verb: "cast", from: "graveyard", kind: "graveyard-recursion" },
  // Exile-and-return-to-the-battlefield is the blink half of a flicker; the exile half states no
  // payoff of its own. Matched on the RETURN so one Ability carries the kind, as the live tags do.
  { verb: "return", from: "exile", to: "battlefield", kind: "flicker" },
  { verb: "put", from: "exile", to: "battlefield", kind: "flicker" },
  // Cards put into a graveyard from the LIBRARY are self-mill, the same payoff `mill` names.
  // `from: null` is load-bearing: "put target creature into its owner's graveyard" moves it off the
  // battlefield, which is removal, and calling that a top-manipulation payoff would mesh removal
  // with every mill deck. Listed last so the from:"graveyard" rules above win when both apply.
  { verb: "put", from: null, to: "graveyard", kind: "top-manipulation" },
];

/** Kinds whose whole meaning is the zone the subject sits in: `edges.ts` will not draw a
 *  reanimator edge unless `effect.subject.zone === "graveyard"`, so a recursion effect that loses
 *  the zone is a recursion no graveyard-filler can ever feed. */
export const ZONE_SCOPED_KINDS: ReadonlySet<string> = new Set(["graveyard-recursion", "graveyard-hate"]);

const SIMPLE: Record<string, EffectKind> = {
  create: "token-generation",
  "deal-damage": "damage",
  draw: "draw-card",
  "add-mana": "mana-generation",
  "add-counter": "counter-placement",
  "modify-pt": "pump",
  untap: "untap",
  proliferate: "proliferate",
  animate: "animate",
  copy: "clone",
  "extra-combat": "extra-combat",
  // Named because the persist gate refused whole cards over their absence: Orcish Bowmasters
  // (amass), Cyclonus (extra-phase), Cyber Conversion and Ugin's Mastery (turn-face-up). amass puts
  // +1/+1 counters on an Army, creating one first if you have none; counter-placement is the half
  // every payoff in the engine actually reads. turn-face-up flips a manifested or morphed permanent
  // -- a state change of an existing permanent, which is what `animate` already names.
  amass: "counter-placement",
  "extra-phase": "extra-combat",
  "turn-face-up": "animate",
  "trigger-again": "trigger-doubling",
  // No "copy-spell" row: VERBS (normalize-prompt.ts) has only "copy", never "copy-spell", so this
  // row could never fire -- the clause vocabulary cannot distinguish copying a spell from copying a
  // permanent, and every copy effect derives "clone" via the row above.
  mill: "top-manipulation",
  emblem: "token-generation",
  // A tutor rearranges what you draw, which is the same payoff `mill` names. Demonic Tutor's live
  // flat tag is exactly this, so the kind is one the engine already consumes.
  search: "top-manipulation",
  // Same payoff again, from the other end of the library. Barrier of Bones' live flat tag for its
  // surveil is exactly this. Neither verb gets an EMIT: surveil does fill a graveyard, but flat
  // gives Barrier of Bones no emit either, and an invented emit is the change reverted from the
  // bounce/`leaves` work — a starving consumer count is not evidence.
  scry: "top-manipulation",
  surveil: "top-manipulation",
};

/** A restriction is a TAX only when it can be paid through. Propaganda and Ghostly Prison both
 *  carry a live flat tag of `tax`; Bedlam ("Creatures can't block") carries nothing, because no
 *  amount of mana lets you block. The difference is a price, and it is stated in the object. */
const PAYABLE = /\bunless\b[^.]*\bpay/i;

/** Keywords whose grant the engine has a kind for. `speed-increase` is what the FLAT tagger already
 *  assigns to Berserkers' Onslaught's double strike, and `mechanisms.ts` consumes it for
 *  attack-matters, so this feeds a rule that exists rather than inventing one.
 *
 *  Nothing else granted gets a kind, and that is deliberate. hexproof / indestructible / shroud /
 *  ward are the `protection` deck ROLE, which `build.ts:126` already derives from oracle text with
 *  no help from tags; flying, trample and menace are evasion, which has no kind at all. Giving them
 *  a near-miss would be worse than silence — it is consumed as if it were true. */
const SPEED_KEYWORDS = /\b(haste|double strike)\b/i;

/** `cost-modify` is one verb because the clause states one action; the direction is in the object,
 *  and the two directions are OPPOSITE kinds the engine already consumes heavily (cost-reduction on
 *  610 cards, tax on 615). Foundry Inspector and Urza's Incubator carry live flat cost-reduction
 *  tags; Thalia carries tax.
 *
 *  Naming opponents is enough on its own to read `tax`: nobody writes a card that makes their own
 *  spells worse, so an opponent-scoped cost change is a tax however the direction is worded. With
 *  neither signal the answer is null — guessing between two opposites is the near-miss class this
 *  file exists to refuse. */
function costDirection(object: string): EffectKind | null {
  const t = object.toLowerCase();
  if (/\bmore\b/.test(t) || /\bopponents?\b/.test(t)) return "tax";
  if (/\bless\b|\bcosts? \{?\d/.test(t)) return "cost-reduction";
  return null;
}

/** Whose graveyard an exile empties. Exiling YOUR OWN graveyard is a cost paid in your own
 *  resources — escape, delve, Mizzix's Mastery copying the spell it exiles — and is the opposite of
 *  hating someone else's. 25 of the 58 graveyard-hate actions in the corpus are that shape, so
 *  nearly half of every self-fuel card was reading as a graveyard-hate payoff.
 *
 *  The object is asked first because it is the action's own text; the clause is a fallback for the
 *  cards whose object is just "that card" or "it" (Necropotence, Cavalier of Thorns). A clause
 *  naming BOTH graveyards refuses to answer rather than guess, which leaves today's kind. */
const YOUR_YARD = /\byour graveyard\b/i;
const OTHER_YARD = /\b(?:target player'?s?|opponents?'?s?|each player'?s?|their)\s+graveyards?\b/i;

function exilesOwnGraveyard(object: string, clauseText: string): boolean {
  if (YOUR_YARD.test(object)) return true;
  if (OTHER_YARD.test(object)) return false;
  return YOUR_YARD.test(clauseText) && !OTHER_YARD.test(clauseText);
}

export function actionEffectKind(action: Action, clauseText = ""): EffectKind | null {
  const verb = action.verb ?? "";
  // 342 corpus cards carry a grant-ability action and the verb had no row here at all, so Lightning
  // Greaves and Swiftfoot Boots derived nothing whatsoever.
  if (verb === "grant-ability") {
    return SPEED_KEYWORDS.test(action.object ?? "") ? "speed-increase" : null;
  }
  if (verb === "cant") return PAYABLE.test(action.object ?? "") ? "tax" : null;
  if (verb === "cost-modify") return costDirection(action.object ?? "");
  for (const r of ZONE_RULES) {
    if (r.verb !== verb) continue;
    if (r.from !== undefined && (action.fromZone ?? null) !== r.from) continue;
    if (r.to && (action.toZone ?? null) !== r.to) continue;
    // See exilesOwnGraveyard. Null rather than a kind of its own: the payoff this card actually has
    // is carried by the OTHER actions in the same clause, and a near-miss kind is consumed as if it
    // were true while null is honestly inert.
    if (r.kind === "graveyard-hate" && exilesOwnGraveyard(action.object ?? "", clauseText)) return null;
    return r.kind;
  }
  // Life change is one verb per direction, but which kind depends on whose life it is.
  if (verb === "gain-life") return "lifegain";
  if (verb === "lose-life" || verb === "set-life") {
    return parseSubject(action.object ?? "").control === "you" ? null : "player-life-loss";
  }
  return SIMPLE[verb] ?? null;
}
