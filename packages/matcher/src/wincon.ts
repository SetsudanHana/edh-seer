import type { Reason } from "@edh-seer/engine";
import { RESOURCE_TOKENS } from "./archetypes.js";
import { affordableAt, arrival, HORIZON, STARTING_LIFE } from "./pressure.js";
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
    // A TOKEN AN OPPONENT GETS IS THEIR BOARD (#574): Beast Within, Generous Gift, Crib Swap and
    // Stroke of Midnight are removal that pays the victim a token, and were 3 of Yuna's 7 go-wide cards.
    if (subject.control === "opp") return false;
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
 *  The GATE is deck-level, and therefore code rather than a rules row (design §13.1 tier 3):
 *  "go-wide = token producers PLUS count-matters consumers" is a signature over the whole deck, and
 *  no per-card rule can express the second half. This is the per-card half; `winconReport` asks
 *  whether any card in the deck passes it, and names the ones that do.
 *
 *  It is not optional detail. Without it every deck in the calibration set read as go-wide -- 71 of
 *  71, and the primary plan of 52 -- because almost every EDH deck makes a token somewhere. A token
 *  maker with nothing to pay it off is not a win plan, it is a body. */
const NOT_A_WIN = new Set(["cost-reduction", "mana-generation"]);
const COUNTS_CARDS = /\b(?:number of|for each) creature cards?\b/i;
function isWidePayoff(dc: DeckCard): boolean {
  return (dc.tags?.abilities ?? []).some((a) => {
    // Count-matters: an effect whose SIZE is the board. Craterhoof, Shamanic Revelation, an
    // Impact Tremors that scales. This half needs no anthem at all.
    // `per-permanent` is deliberately NOT here: it passes on Brass's Bounty, which makes a
    // Treasure per land and is ramp. Only "scales with creatures" is a go-wide payoff.
    // A COST OR MANA THAT SCALES IS NOT A WIN (#574, #647): Blasphemous Act costs {1} less per
    // creature and read as the one card that "turns it into a win" on a wide-board Rani deck; Axebane
    // Guardian's mana per defender is Brass's Bounty again. A denylist, not an allowlist of damage,
    // pump and drain: measured 2026-09-27, the allowlist dropped go-wide from 14 of the 71 decks and
    // took Malakir Blood-Priest's drain and Kindred Charge with it -- their effect kind is blank.
    // AND WHAT IT COUNTS IS THE BOARD: "the number of creature CARDS in target player's graveyard"
    // (Corpse Augur) is per-creature too, and read as a go-wide payoff on Party Time (#574). A card is
    // a creature off the battlefield -- all 38 corpus scalers printing it count a graveyard, a hand,
    // a library or what was exiled or milled; derive leaves most of their scaling zones blank.
    if (a.effect.scaling === "per-creature" && !NOT_A_WIN.has(a.effect.kind) && !COUNTS_CARDS.test(dc.card.oracleText ?? "")) return true;
    // An anthem is a STATIC pump aimed at a CLASS. `pump` alone is every combat trick in Magic
    // and made this gate vacuous -- it passed all 71 calibration decks, changing nothing.
    // Equipment is excluded by the same test: its static pump names the equipped creature
    // (`self`), not a type.
    if (a.kind !== "static" || a.effect.kind !== "pump") return false;
    const subject = a.effect.subject;
    if (!subject || subject.self) return false;
    const types = Array.isArray(subject.type) ? subject.type : subject.type ? [subject.type] : [];
    return types.some((t) => ["creature", "permanent"].includes(t.toLowerCase()));
  });
}

export interface WinconReport {
  /** EVERY CLASS NAMES ITS CARDS (owner, 2026-09-26: "we should be able to determine how the deck
   *  can win"). This was carried for `combo` and `alt-win` only, on the grounds that nothing read
   *  the longer lists. The baseline round's plan seat read "go-wide 8 · voltron 7 · burn 6" and could
   *  not say which cards win, which is r/EDH's first piece of advice ("pick a way"). A count a reader
   *  cannot check is also a detection they cannot catch when it is wrong.
   *
   *  `payoffs` is go-wide's second half: the cards that turn the board into a win (anthems and
   *  anything that scales with creatures). They gate the class but are not counted in it, so they
   *  were the one part of the plan the report checked and never named. */
  classes: { class: string; count: number; share: number; cards?: string[]; payoffs?: string[]; drain?: Drain }[];
  /** Herfindahl over the shares. */
  focus: number;
  /** The largest class, absent when the deck names no wincon. */
  primary?: string;
}

/** THE DRAIN PER TURN (#984, owner ruling 2026-10-06). The burn route stays untimed, and says how
 *  much life its repeating drains take from each opponent if each fires once a turn: a floor, since a
 *  trigger can fire many times, stated as the assumption it is. */
export interface Drain {
  /** Burn cards with a repeating drain of a fixed amount. */
  cards: number;
  /** Their amounts added, one fire per card: life each opponent loses per turn at that rate. */
  life: number;
}

const DRAIN_KINDS = new Set(["player-damage", "player-life-loss", "drain", "damage"]);
const REPEATING = new Set(["repeatable", "per-turn", "per-cycle"]);
const EACH = new Set(["each", "all"]);

/** A card's repeating, fixed-amount drains aimed at each opponent, with the ability's FACE and its
 *  index WITHIN that face -- the frame `Reason.consumerAbility` is stamped in (`faces.ts` splits a
 *  card's abilities per face), so the drain route joins on both. A one-shot (an instant, an ETB that
 *  happens once) is not a rate, and an X amount is not a number. */
export function drainAbilities(dc: DeckCard): { face: number; index: number; amount: number; ability: DrainAbility }[] {
  const out: { face: number; index: number; amount: number; ability: DrainAbility }[] = [];
  const seenOnFace = new Map<number, number>();
  for (const a of dc.tags?.abilities ?? []) {
    const ab = a as DrainAbility;
    const face = ab.face ?? 0;
    const index = seenOnFace.get(face) ?? 0;
    seenOnFace.set(face, index + 1);
    if (ab.kind !== "triggered" && ab.kind !== "activated") continue;
    // A LABEL, NOT ITS ABSENCE (review of #1045): an unset `repeats` means the rules could not tell,
    // and "each opponent" is what the sentence says, so a single-target drain is not counted.
    if (!REPEATING.has(ab.repeats ?? "") || !DRAIN_KINDS.has(ab.effect?.kind ?? "")) continue;
    if (ab.effect?.subject?.control !== "opp" || !EACH.has(ab.effect.subject.scope ?? "")) continue;
    if (!/^\d+$/.test(ab.amount ?? "")) continue;
    out.push({ face, index, amount: Number(ab.amount), ability: ab });
  }
  return out;
}

type DrainAbility = {
  kind?: string; face?: number; repeats?: string; amount?: string;
  trigger?: { verbs?: string[]; batched?: true };
  effect?: { kind?: string; subject?: { control?: string; scope?: string } };
};

/** Each card counted once, by its largest repeating, fixed-amount drain aimed at the opponents. */
export function drainPerTurn(deck: readonly DeckCard[], names: ReadonlySet<string>): Drain | undefined {
  let cards = 0, life = 0;
  for (const dc of deck) {
    if (!names.has(dc.card.name)) continue;
    const best = Math.max(0, ...drainAbilities(dc).map((d) => d.amount));
    if (best > 0) { cards++; life += best; }
  }
  return cards ? { cards, life } : undefined;
}

/** THE DRAIN ROUTE'S TURN (#1056, R5; owner 2026-10-06: speed is the turn the whole table can be
 *  dead, a rough floor per route, and for a drain "how many triggers of Impact Tremors would you
 *  have"). A drain at EACH opponent kills the table when one opponent's 40 is gone.
 *
 *  It fires once per SOURCE of its trigger, and the sources are the reasons the edge layer already
 *  joined to that very ability (`consumerAbility`). A source is dated by `arrival`:
 *  - a card that is the event itself (a creature entering) fires it once, on the turn it arrives;
 *  - a card whose ABILITY makes the event fires it per use: every turn when that ability repeats,
 *    once on arrival when it does not;
 *  - a TOKEN is dated by its MAKER (the `creates:` reason), the same way;
 *  - a phase trigger (upkeep, combat, end step) has no source and fires once a turn; so does an
 *    activated drain, which is a stated assumption ({1}: could fire many times), not a floor.
 *  How many events one use makes is the edge's magnitude: its ceiling when finite, else its floor,
 *  at least one. A source that grows with the board (Krenko's X goblins) is counted as one and
 *  NAMED in `unbounded`, so the readout can say so. A batched trigger ("one or more") fires at most
 *  once a turn. Each source is used once a turn; nobody gains life. Rough, by the owner's word.
 *
 *  THE ROUTE ASSUMES ITS DRAIN IS OUT from the turn it can be cast, as the combo route assumes its
 *  pieces: the question is how fast this route kills, not how often it shows up. Weighting the drain
 *  by its odds of being drawn too (first build, 2026-10-06) read Krenko with Impact Tremors at 0.6
 *  life a turn and timed 8 decks of 45 -- an average over games mostly WITHOUT the payoff. The
 *  sources stay weighted by their draw odds: those are the deck, the drain is the route. */
export interface DrainClock {
  /** First turn the drains have taken 40 from each opponent; absent past the horizon. */
  turn?: number;
  /** Life each opponent loses on each turn, turn 1 first, to the horizon. */
  perTurn: number[];
  /** The drain cards counted. */
  cards: string[];
  /** Sources whose events grow with the board, counted as one each. */
  unbounded: string[];
}

const PHASE_VERBS = new Set(["upkeep", "begin-combat", "end-step"]);

export function drainClock(
  deck: readonly DeckCard[],
  reasons: readonly Reason[],
  opts: { commanderNames?: readonly string[]; manaBudget?: readonly number[] } = {},
): DrainClock | undefined {
  const byName = new Map(deck.map((dc) => [dc.card.name, dc]));
  const on = arrival(deck, opts);
  const arrives = (dc: DeckCard, t: number): number => on(dc, t) - on(dc, t - 1);
  const unbounded = new Set<string>();
  const perUse = (r: Reason): number => {
    const m = r.magnitude;
    if (!m) return 1;
    if (m.ceiling === null && r.producer) unbounded.add(r.producer);
    return Math.max(1, m.ceiling ?? m.floor);
  };
  // Ability indexes are per FACE (see `drainAbilities`).
  const repeats = (dc: DeckCard, face: number | undefined, ability: number | undefined): boolean =>
    ability !== undefined && REPEATING.has(((dc.tags?.abilities ?? []).filter((a) => ((a as DrainAbility).face ?? 0) === (face ?? 0))[ability] as DrainAbility | undefined)?.repeats ?? "");
  /** Events one card-side source makes on turn t: per use, every turn it is out when it repeats. */
  const fromCard = (dc: DeckCard, r: Reason, t: number): number =>
    perUse(r) * (repeats(dc, r.producerFace, r.producerAbility) ? on(dc, t) : arrives(dc, t));
  // ONE SOURCE, ONE COUNT: a trigger with a chain of effects says itself in several reasons that
  // differ only in `effectKind` (Archon of Cruelty: six), so sources are keyed by who supplies the
  // event and through which ability, never by reason.
  const sourceKey = (r: Reason): string => `${r.producer}|${r.producerFace ?? 0}|${r.producerAbility ?? "-"}|${r.producerIsToken ? 1 : 0}`;
  const distinct = (rs: readonly Reason[]): Reason[] => [...new Map(rs.map((r) => [sourceKey(r), r])).values()];
  const makers = new Map<string, Reason[]>();
  for (const r of reasons) {
    if (!r.tag.startsWith("creates:") || !r.consumer || !r.producer) continue;
    makers.set(r.consumer, [...(makers.get(r.consumer) ?? []), r]);
  }
  for (const [token, rs] of makers) makers.set(token, distinct(rs));

  const drains = deck.flatMap((dc) => drainAbilities(dc).map((d) => ({
    dc, ...d, sources: distinct(reasons.filter((r) =>
      r.consumer === dc.card.name && (r.consumerFace ?? 0) === d.face && r.consumerAbility === d.index)),
  })));
  if (drains.length === 0) return undefined;
  const perTurn: number[] = [];
  let cumulative = 0, turn: number | undefined;
  for (let t = 1; t <= HORIZON; t++) {
    let life = 0;
    for (const d of drains) {
      let fires: number;
      if (d.ability.kind === "activated" || (d.ability.trigger?.verbs ?? []).some((v) => PHASE_VERBS.has(v))) {
        fires = 1;
      } else {
        fires = 0;
        for (const r of d.sources) {
          if (r.producerIsToken) {
            for (const m of makers.get(r.producer ?? "") ?? []) {
              const maker = byName.get(m.producer!);
              if (maker) fires += fromCard(maker, m, t);
            }
            continue;
          }
          const producer = byName.get(r.producer ?? "");
          if (producer) fires += fromCard(producer, r, t);
        }
        if (d.ability.trigger?.batched) fires = Math.min(1, fires);
      }
      life += d.amount * fires * (d.dc.card.manaValue <= affordableAt(opts.manaBudget, t) ? 1 : 0);
    }
    perTurn.push(Math.round(life * 100) / 100);
    cumulative += life;
    if (turn === undefined && cumulative >= STARTING_LIFE) turn = t;
  }
  return {
    ...(turn !== undefined ? { turn } : {}),
    perTurn,
    cards: [...new Set(drains.map((d) => d.dc.card.name))],
    unbounded: [...unbounded].sort(),
  };
}

/** The deck's win plans and how concentrated they are.
 *
 *  `combo` is passed IN rather than detected: the report already carries known combos from the
 *  combo index, which is real data but is not the chain detection design §12.5 asks for. Deriving
 *  a terminal chain from our own graph is a later step, and until then this class says "the deck
 *  contains a known combo" and claims nothing more. */
export function winconReport(
  deck: readonly DeckCard[],
  opts: { comboCards?: readonly string[]; comboPayoffs?: readonly string[] } = {},
): WinconReport {
  const members = detectWincons(deck);
  const payoffs = [...new Set(deck.filter(isWidePayoff).map((dc) => dc.card.name))].sort();
  if (payoffs.length === 0) members.delete("go-wide");
  const combo = (opts.comboCards ?? []).filter((n) => deck.some((dc) => dc.card.name === n));
  const comboPayoffs = [...(opts.comboPayoffs ?? [])].filter((n) => deck.some((dc) => dc.card.name === n)).sort();
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
      cards: [...(members.get(cls) ?? [])].sort(),
      ...(cls === "go-wide" ? { payoffs } : {}),
      ...(cls === "burn" && drainPerTurn(deck, members.get(cls) ?? new Set()) ? { drain: drainPerTurn(deck, members.get(cls) ?? new Set())! } : {}),
      // THE COMBO'S WIN, NAMED (owner, 2026-09-29): a loop repeats an event forever, and these are the
      // cards that turn that event into lost games for the table.
      ...(cls === "combo" && comboPayoffs.length > 0 ? { payoffs: comboPayoffs } : {}),
    }))
    .sort((a, b) => b.count - a.count || a.class.localeCompare(b.class));

  return { classes, focus: focusIndex(counts), ...(classes[0] ? { primary: classes[0].class } : {}) };
}
