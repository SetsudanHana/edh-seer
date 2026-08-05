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
  "trigger-again": "trigger-doubling",
  // No "copy-spell" row: VERBS (normalize-prompt.ts) has only "copy", never "copy-spell", so this
  // row could never fire -- the clause vocabulary cannot distinguish copying a spell from copying a
  // permanent, and every copy effect derives "clone" via the row above.
  mill: "top-manipulation",
  emblem: "token-generation",
  // A tutor rearranges what you draw, which is the same payoff `mill` names. Demonic Tutor's live
  // flat tag is exactly this, so the kind is one the engine already consumes.
  search: "top-manipulation",
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

export function actionEffectKind(action: Action): EffectKind | null {
  const verb = action.verb ?? "";
  // 342 corpus cards carry a grant-ability action and the verb had no row here at all, so Lightning
  // Greaves and Swiftfoot Boots derived nothing whatsoever.
  if (verb === "grant-ability") {
    return SPEED_KEYWORDS.test(action.object ?? "") ? "speed-increase" : null;
  }
  if (verb === "cant") return PAYABLE.test(action.object ?? "") ? "tax" : null;
  for (const r of ZONE_RULES) {
    if (r.verb !== verb) continue;
    if (r.from !== undefined && (action.fromZone ?? null) !== r.from) continue;
    if (r.to && (action.toZone ?? null) !== r.to) continue;
    return r.kind;
  }
  // Life change is one verb per direction, but which kind depends on whose life it is.
  if (verb === "gain-life") return "lifegain";
  if (verb === "lose-life" || verb === "set-life") {
    return parseSubject(action.object ?? "").control === "you" ? null : "player-life-loss";
  }
  return SIMPLE[verb] ?? null;
}
