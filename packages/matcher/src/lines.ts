/** Threshold lines: what a deck must hold to reach a printed number.
 *
 *  Reads the resource ledger's three fields (`trigger.threshold`, `Ability.amount`, `Ability.cost`)
 *  and emits one record per threshold anchor. Pure -- no store, no I/O.
 *  Design: docs/superpowers/specs/2026-08-14-threshold-lines-design.md */

import type { DeckCard } from "./types.js";

export type Growth =
  | { kind: "multiplicative"; factor: number }
  | { kind: "additive"; step: number }
  | { kind: "unknown" };

/** Word numerals the corpus actually uses. "two" is 6 instances; the rest are here so a single
 *  printing does not open a hole. */
const WORD_NUMERALS: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/** MULTIPLIERS ARE AN ENUMERATED LEXICON, NEVER A SUBSTRING TEST.
 *
 *  Measured over the derived corpus: 2,169 abilities carry an `amount`, 310 distinct values, and
 *  the entire multiplicative family is "double" x7, "triple" x2, "twice" x1, "double the number
 *  of" x1, "twice that many" x1.
 *
 *  `double strike` also appears as an amount and is a KEYWORD. A /double/ substring test classifies
 *  it as a x2 multiplier and hands a growth model to an ability that grows nothing -- the same shape
 *  as `\b\d+\b` reading "1,000" as 0 in the resource ledger. Both were found by printing the values
 *  rather than reasoning about them. */
const MULTIPLIERS: readonly [RegExp, number][] = [
  [/^doubles?\b/, 2],
  [/^twice\b/, 2],
  [/^triples?\b/, 3],
];

/** "half their life, rounded up", "half x, rounded down" -- 5 corpus instances. A shrinking
 *  multiplier never carries a resource toward a threshold, so it is not growth. Tested BEFORE the
 *  multiplier lexicon so nothing can read "half" as a factor. */
const SHRINKING = /^half\b/;

export function classifyGrowth(amount: string | undefined): Growth {
  if (amount === undefined) return { kind: "unknown" };
  const t = amount.trim().toLowerCase();
  if (t === "") return { kind: "unknown" };
  // A keyword that happens to start with a multiplier word. Checked first and by name.
  if (/^double strike\b/.test(t)) return { kind: "unknown" };
  if (SHRINKING.test(t)) return { kind: "unknown" };
  for (const [re, factor] of MULTIPLIERS) if (re.test(t)) return { kind: "multiplicative", factor };
  // A P/T amount ("+1/+1", "-1/-1") is a stat change, not a count. The slash is the whole tell.
  if (t.includes("/")) return { kind: "unknown" };
  // The thousands separator is stripped before parsing -- "1,000" is 1000, not 1. Same fix as the
  // resource ledger's threshold regex.
  const numeric = /^-?\d+(?:,\d{3})*$/.exec(t);
  if (numeric) {
    const n = parseInt(t.replace(/,/g, ""), 10);
    return n > 0 ? { kind: "additive", step: n } : { kind: "unknown" };
  }
  const word = WORD_NUMERALS[t];
  if (word !== undefined) return { kind: "additive", step: word };
  // "x" (106), "that many" (23), "that much" (22) and everything else: refused, never defaulted.
  return { kind: "unknown" };
}

/** How many times the amplifier must fire to carry `base` to `threshold`.
 *
 *  Multiplicative: ceil(log_f(N / b)). Additive: ceil((N - b) / k). The two answers differ by two
 *  orders of magnitude on the witnesses -- Calendar's 1,000 at x2 is 10, Simic Ascendancy's 20 at
 *  +1 is 20 -- which is the entire reason the classifier exists.
 *
 *  `undefined` for an unknown growth model, and for a multiplicative model with nothing to multiply.
 *  A refused answer is the point: a missing number beats a wrong one. */
export function iterationsNeeded(threshold: number, growth: Growth, base: number): number | undefined {
  if (base >= threshold) return 0;
  if (growth.kind === "additive") return Math.ceil((threshold - base) / growth.step);
  if (growth.kind === "multiplicative") {
    if (base <= 0) return undefined;
    const raw = Math.log(threshold / base) / Math.log(growth.factor);
    // log_3(9) is 2.0000000000000004 in IEEE-754, not exactly 2 -- factor 2 doesn't hit this
    // because its powers are exactly representable in binary floating point, but factor 3 (and any
    // non-power-of-2 factor) does, at every exact power. A bare ceil overcounts by one there. Snap
    // to the nearest integer only when within float noise of one, so a true non-power (10 at x3 from
    // 1: raw ~2.096) is untouched and still rounds up to 3.
    const rounded = Math.round(raw);
    const snapped = Math.abs(raw - rounded) < 1e-9 ? rounded : raw;
    return Math.ceil(snapped);
  }
  return undefined;
}

export interface Resource { kind: "counter" | "type"; name: string }

export interface Piece {
  card: string;
  role: "anchor" | "amplifier" | "supplier" | "untap" | "extra-turn" | "extra-phase" | "copy";
  /** True when the piece is named by KIND but the engine cannot prove it applies to this line --
   *  Gogo copies "target activated or triggered ability" and no SubjectFilter can name an ability. */
  unproven?: boolean;
  /** Set only on an `extra-phase` piece: which phase it grants. The whole reason the field exists --
   *  a reader must be able to tell Sphinx's `beginning` (brings an untap step, real supply) from
   *  Obeka/Paradox Haze/The Ninth Doctor's `upkeep` (pays out in upkeeps, brings none), and the two
   *  look identical without it. Owner's ruling, 2026-08-14. */
  phase?: string;
}

export interface Line {
  anchor: string;
  resource: Resource;
  threshold: number;
  growth: Growth["kind"];
  factor?: number;
  base: number;
  iterations?: number;
  terminal?: string;
  needsUntap: boolean;
  pieces: Piece[];
  refusals: string[];
}

/** Effect kinds that supply activations UNCONDITIONALLY. `untap` frees a {T} ability outside the
 *  untap step; an extra turn brings a whole new one. `extra-phase` is NOT here -- only some of its
 *  phases carry an untap step (see `UNTAP_PHASES` below), so it needs its own gate rather than a
 *  flat table entry. `extra-combat` is deliberately absent from both -- an additional combat phase
 *  has no untap step. */
const SUPPLY_ROLE: Readonly<Record<string, Piece["role"]>> = {
  untap: "untap", "extra-turn": "extra-turn",
};

/** Which `extra-phase` phases bring their own untap step, and are therefore activation supply.
 *  Owner's ruling, 2026-08-14 (threshold-lines spec §4.3), measured over the corpus: Sphinx of the
 *  Second Sun (`beginning`) is the real thing; The Ninth Doctor, Obeka and Paradox Haze are all
 *  `upkeep` -- an untap-shaped TRIGGER that pays out in upkeep STEPS, which bring no untap. Both are
 *  present for completeness (a `phase: "untap"` printing would be supply too); none exists yet. */
const UNTAP_PHASES: ReadonlySet<string> = new Set(["beginning", "untap"]);

/** What the threshold counts. A counter is exact; a zone/type trigger names its type. Anything else
 *  is refused -- an anchor whose resource cannot be named cannot have its suppliers identified
 *  either, and a piece set built from unidentified suppliers is a confidently wrong answer. */
function resourceOf(trigger: Record<string, any>): Resource | undefined {
  const s = trigger.subject ?? {};
  if (typeof s.counter === "string" && s.counter) return { kind: "counter", name: s.counter };
  const type = Array.isArray(s.type) ? s.type[0] : s.type;
  if (typeof type === "string" && type) return { kind: "type", name: type };
  const sub = Array.isArray(s.subtype) ? s.subtype[0] : s.subtype;
  if (typeof sub === "string" && sub) return { kind: "type", name: sub };
  return undefined;
}

/** Does this ability's effect act on the line's resource? A counter resource is matched on the
 *  effect subject's own counter field, which is how `pump{counter:time}` is told from a P/T pump. */
function actsOnResource(ability: Record<string, any>, resource: Resource): boolean {
  const s = ability.effect?.subject ?? {};
  if (resource.kind === "counter") return s.counter === resource.name;
  const type = Array.isArray(s.type) ? s.type : [s.type];
  return type.includes(resource.name);
}

/** Does this ability ADD the resource when it fires? Read off `emits`, which is where the resource
 *  ledger's own witness lives: Calendar's accumulator emits `counter-added{counter:time}`. */
function suppliesResource(ability: Record<string, any>, resource: Resource): boolean {
  for (const e of ability.emits ?? []) {
    if (resource.kind === "counter" && e.subject?.counter === resource.name) return true;
    if (resource.kind === "type") {
      const t = Array.isArray(e.subject?.type) ? e.subject.type : [e.subject?.type];
      if (t.includes(resource.name)) return true;
    }
  }
  return false;
}

export function detectLines(deck: readonly DeckCard[]): Line[] {
  const lines: Line[] = [];
  // A trigger object is built ONCE PER CLAUSE and shared by every ability that clause derives, so
  // Calendar's [2] and [3] are the same anchor seen twice. Keying on the trigger object's identity
  // collapses them, and reading the sibling is how the terminal is recovered at all: [2] carries a
  // blank effect kind and [3] carries the player-life-loss.
  for (const dc of deck) {
    const abilities = (dc.tags?.abilities ?? []) as unknown as Record<string, any>[];
    // Reference identity (`x.trigger === a.trigger`) is how a single derive.ts run shares the
    // object in memory, but a Mongo round-trip (or a hand-written test fixture) never preserves
    // object identity for repeated nested values -- only the CONTENT survives. Structural equality
    // is a superset that collapses both cases and is what actually has to run against persisted
    // documents.
    const triggerKey = (t: unknown): string => JSON.stringify(t);
    const seen = new Set<string>();
    for (const a of abilities) {
      const threshold = a.trigger?.threshold?.atLeast;
      if (typeof threshold !== "number") continue;
      const key = triggerKey(a.trigger);
      if (seen.has(key)) continue;
      seen.add(key);

      const refusals: string[] = [];
      const resource = resourceOf(a.trigger);
      if (!resource) continue; // counted by the caller's tally; emits nothing

      const siblings = abilities.filter((x) => triggerKey(x.trigger) === key);
      const terminal = siblings.map((x) => String(x.effect?.kind ?? "")).find((k) => k !== "");

      const pieces: Piece[] = [{ card: dc.card.name, role: "anchor" }];
      let growth: Growth = { kind: "unknown" };
      let base = 0;
      let needsUntap = false;

      for (const other of deck) {
        for (const b of (other.tags?.abilities ?? []) as unknown as Record<string, any>[]) {
          if (actsOnResource(b, resource) && b !== a) {
            const g = classifyGrowth(b.amount);
            if (g.kind === "multiplicative" && growth.kind !== "multiplicative") {
              growth = g;
              pieces.push({ card: other.card.name, role: "amplifier" });
              if (typeof b.cost === "string" && b.cost.includes("{T}")) needsUntap = true;
            }
          }
          if (suppliesResource(b, resource)) {
            const g = classifyGrowth(b.amount);
            if (g.kind === "additive") base = Math.max(base, g.step);
            if (growth.kind === "unknown") growth = g;
            if (other.card.name !== dc.card.name) pieces.push({ card: other.card.name, role: "supplier" });
          }
          // Activation supply. `untap` and `extra-turn` count unconditionally; `extra-phase` counts
          // ONLY when the phase it grants itself carries an untap step (`UNTAP_PHASES`) -- Sphinx of
          // the Second Sun's `beginning` does, The Ninth Doctor/Obeka/Paradox Haze's `upkeep` does
          // not, and the phase is recorded on the piece so a reader can tell why.
          const kind = String(b.effect?.kind ?? "");
          if (kind === "extra-phase") {
            const phase = b.effect?.subject?.phase;
            if (typeof phase === "string" && UNTAP_PHASES.has(phase)) {
              pieces.push({ card: other.card.name, role: "extra-phase", phase });
            }
          } else {
            const role = SUPPLY_ROLE[kind];
            if (role) pieces.push({ card: other.card.name, role });
          }
          // Gogo: a copier is activation supply that needs no untap at all. Named by KIND and a
          // non-fixed amount, and marked unproven -- `effect.subject` is absent because no
          // SubjectFilter can name an ability, so nothing here proves it copies THIS one.
          if (b.effect?.kind === "clone" && classifyGrowth(b.amount).kind === "unknown") {
            pieces.push({ card: other.card.name, role: "copy", unproven: true });
          }
        }
      }

      // "that many" / "that much" leaves the per-fire supply unstated. 1 is the PESSIMISTIC reading,
      // so the iteration count comes out an upper bound -- wrong in the safe direction only. Said
      // out loud in `refusals` rather than hidden.
      if (base === 0 && growth.kind === "multiplicative") { base = 1; refusals.push("assumed-base-1"); }
      if (growth.kind === "unknown") refusals.push("unknown-growth");
      if (!terminal) refusals.push("no-terminal");

      lines.push({
        anchor: dc.card.name, resource, threshold, growth: growth.kind,
        factor: growth.kind === "multiplicative" ? growth.factor : undefined,
        base, iterations: iterationsNeeded(threshold, growth, base), terminal,
        needsUntap,
        pieces: pieces.filter((p, i) => pieces.findIndex((q) => q.card === p.card && q.role === p.role) === i),
        refusals,
      });
    }
  }
  return lines;
}
