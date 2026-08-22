import { RESOURCE_TOKENS } from "./archetypes.js";
import { loadRules, ruleMatches } from "./rules.js";
import type { DeckCard } from "./types.js";

/** Which cards fill each wincon class, by the structural signatures in `rules.json`.
 *
 *  DERIVED, NEVER LOOKED UP. An archetype-to-wincon table is exactly the Tier C defect the design
 *  criticises elsewhere: it would encode a guess about what a deck is trying to do instead of
 *  reading what its cards actually do. Every class has a signature the engine already carries. */
export function detectWincons(deck: readonly DeckCard[]): Map<string, Set<string>> {
  const set = loadRules();
  const out = new Map<string, Set<string>>();
  const add = (cls: string, name: string): void => {
    let s = out.get(cls);
    if (!s) { s = new Set(); out.set(cls, s); }
    s.add(name);
  };
  for (const dc of deck) {
    for (const rule of set.rules) {
      if (!rule.winconClass || !ruleMatches(rule, dc, set)) continue;
      add(rule.winconClass, dc.card.name);
    }
    if (makesCreatureTokens(dc)) add("go-wide", dc.card.name);
  }
  return out;
}

/** Token subtypes that are RESOURCES, not a board. A Treasure is ramp and a Clue is card draw; a
 *  deck full of them is not going wide.
 *
 *  ONE SET, THREE CONSUMERS (2026-08-21). This file and `archetypes.ts` each held their own copy,
 *  and the divergence cost a measurement: the first arm of the roadmap's G2 token fold re-derived
 *  the same Treasure defect a THIRD time, headlining `magar-spellslinger` (a spellslinger deck) and
 *  `mari-takes-control` (a control deck) as "artifacts created" off their Treasures. The question
 *  every site asks is identical -- "is this token a board or a resource" -- so the SET is shared and
 *  each consumer still does its own thing with the answer: this file drops them from go-wide,
 *  `archetypes.ts` refuses them the Tokens signature, and the theme fold refused to fold them.
 *  (The `manaToken` this comment used to cite no longer exists anywhere in the repo.) */
export { RESOURCE_TOKENS } from "./archetypes.js";

/** Does this card make CREATURE tokens?
 *
 *  Code rather than a `rules.json` row, and not for convenience: the question is about the token
 *  the ability CREATES, which lives on the effect's own subject. Every operator in the rules file
 *  reads the card -- its text, its type line, its subtypes -- and none of them can see inside an
 *  ability's effect.
 *
 *  Measured cost of getting this wrong: keying go-wide on `token-generation` alone put it in all 71
 *  calibration decks and made it the PRIMARY plan of 52, because "An Offer You Can't Refuse",
 *  "Pirate's Pillage" and "Unexpected Windfall" all create tokens -- Treasures. */
function makesCreatureTokens(dc: DeckCard): boolean {
  return (dc.tags?.abilities ?? []).some((a) => {
    if (!["token-generation", "token-doubling"].includes(a.effect.kind)) return false;
    // A TOKEN THAT LEAVES AT THE NEXT END STEP IS NOT A BOARD YOU WIN WITH. Inalla copies a Wizard
    // and exiles it at the beginning of the next end step; she was counted among 12 go-wide cards on
    // a board that does not exist when the turn ends. Found by the TUNER persona rejecting its own
    // deck's report: "my tokens are sacrificed at end of turn, so tuning toward a go-wide plan would
    // make the deck worse."
    //
    // THIS IS THE ONLY READER OF `temporary`, deliberately. The token keeps every edge it has --
    // it enters, so the ETB payoffs it feeds are real and are Inalla's actual engine; it attacks
    // with haste; it can be sacrificed in response. Only the WIN-PLAN reading excludes it. Deleting
    // its relations to fix this label would repeat the `entersTapped` mistake, which silently
    // removed 29 real claims.
    if (a.temporary) return false;
    const subject = a.effect.subject;
    // Token doubling has no subject of its own -- it doubles whatever you were already making, so
    // it is a go-wide payoff on any board.
    if (!subject) return a.effect.kind === "token-doubling";
    const subtypes = (Array.isArray(subject.subtype) ? subject.subtype : subject.subtype ? [subject.subtype] : [])
      .map((s) => s.toLowerCase());
    if (subtypes.some((s) => RESOURCE_TOKENS.has(s))) return false;
    const types = (Array.isArray(subject.type) ? subject.type : subject.type ? [subject.type] : [])
      .map((t) => t.toLowerCase());
    // A creature type with no card type (a "Zombie token") is still a creature token; an artifact
    // token that names no creature subtype is not.
    if (types.includes("creature")) return true;
    return types.length === 0 && subtypes.length > 0;
  });
}

/** Herfindahl over the class shares: 1 when every wincon card serves one plan, 1/n when they are
 *  split evenly across n plans, 0 when the deck names no wincon at all.
 *
 *  THE OPPOSITE OBJECTIVE FUNCTION TO ANSWER COVERAGE, and that is the whole reason it is a separate
 *  number. Coverage wants breadth -- at least one answer for every threat class. Focus wants
 *  concentration -- a deck all-in on one plan beats a deck with three half-plans. Scoring both on
 *  one instrument would reward a deck for being vague. */
export function focusIndex(counts: ReadonlyMap<string, number>): number {
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  return [...counts.values()].reduce((sum, n) => sum + (n / total) ** 2, 0);
}

/** A payoff that turns a board of tokens into a win: an anthem, or anything whose amount scales
 *  with how many creatures or permanents you have.
 *
 *  DECK-LEVEL, and therefore code rather than a rules row (design §13.1 tier 3): "go-wide = token
 *  producers PLUS count-matters consumers" is a signature over the whole deck, and no per-card
 *  predicate can express the second half.
 *
 *  It is not optional detail. Without it every deck in the calibration set read as go-wide -- 71 of
 *  71, and the primary plan of 52 -- because almost every EDH deck makes a token somewhere. A token
 *  maker with nothing to pay it off is not a win plan, it is a body. */
function hasWidePayoff(deck: readonly DeckCard[]): boolean {
  return deck.some((dc) =>
    (dc.tags?.abilities ?? []).some((a) => {
      // Count-matters: an effect whose SIZE is the board. Craterhoof, Shamanic Revelation, an
      // Impact Tremors that scales. This half needs no anthem at all.
      // `per-permanent` is deliberately NOT here: it passes on Brass's Bounty, which makes a
      // Treasure per land and is ramp. Only "scales with creatures" is a go-wide payoff.
      if (a.effect.scaling === "per-creature") return true;
      // An anthem is a STATIC pump aimed at a CLASS. `pump` alone is every combat trick in Magic
      // and made this gate vacuous -- it passed all 71 calibration decks, changing nothing.
      // Equipment is excluded by the same test: its static pump names the equipped creature
      // (`self`), not a type.
      if (a.kind !== "static" || a.effect.kind !== "pump") return false;
      const subject = a.effect.subject;
      if (!subject || subject.self) return false;
      const types = Array.isArray(subject.type) ? subject.type : subject.type ? [subject.type] : [];
      return types.some((t) => ["creature", "permanent"].includes(t.toLowerCase()));
    }),
  );
}

export interface WinconReport {
  /** `cards` is carried for BINARY classes only (`combo`, `alt-win`) and nowhere else. The deck
   *  sentence NAMES an alternate win condition — "wins by an alternate win condition (Thassa's
   *  Oracle)" — because naming it is what lets a reader catch a wrong detection, where "an alternate
   *  win condition" hides one. The other classes hold up to 30 names and a sentence never says
   *  them, so shipping the list would be wire weight nothing reads. */
  classes: { class: string; count: number; share: number; cards?: string[] }[];
  /** Herfindahl over the shares. */
  focus: number;
  /** The largest class, absent when the deck names no wincon. */
  primary?: string;
}

/** The deck's win plans and how concentrated they are.
 *
 *  `combo` is passed IN rather than detected: the report already carries known combos from the
 *  combo index, which is real data but is not the chain detection design §12.5 asks for. Deriving
 *  a terminal chain from our own graph is a later step, and until then this class says "the deck
 *  contains a known combo" and claims nothing more. */
export function winconReport(
  deck: readonly DeckCard[],
  opts: { comboCards?: readonly string[] } = {},
): WinconReport {
  const members = detectWincons(deck);
  if (!hasWidePayoff(deck)) members.delete("go-wide");
  const combo = (opts.comboCards ?? []).filter((n) => deck.some((dc) => dc.card.name === n));
  if (combo.length > 0) members.set("combo", new Set(combo));

  // A floor, in the idiom `ARCHETYPE_FLOOR` already uses for the same reason: two stray cards are
  // not a win plan, and letting them report as one both clutters the list and drags the focus
  // index down -- which would read as "this deck is unfocused" when the truth is "this deck has
  // two cards that happen to match".
  //
  // BINARY CLASSES ARE EXEMPT, exactly as `combo` is exempt from the archetype floor: one Thassa's
  // Oracle IS the plan, and a single "you win the game" does not become truer with a second copy.
  const BINARY = new Set(["combo", "alt-win"]);
  const raw = [...members].map(([cls, names]) => [cls, names.size] as const);
  const pool = raw.reduce((sum, [, n]) => sum + n, 0);
  const counts = new Map(
    raw.filter(([cls, n]) => BINARY.has(cls) || (n >= 2 && n / pool >= 0.1)),
  );
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const classes = [...counts]
    .map(([cls, count]) => ({
      class: cls, count, share: total > 0 ? count / total : 0,
      ...(BINARY.has(cls) ? { cards: [...(members.get(cls) ?? [])].sort() } : {}),
    }))
    .sort((a, b) => b.count - a.count || a.class.localeCompare(b.class));

  return { classes, focus: focusIndex(counts), ...(classes[0] ? { primary: classes[0].class } : {}) };
}
