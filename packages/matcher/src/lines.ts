/** Threshold lines: what a deck must hold to reach a printed number.
 *
 *  Reads the resource ledger's three fields (`trigger.threshold`, `Ability.amount`, `Ability.cost`)
 *  and emits one record per threshold anchor. Pure -- no store, no I/O.
 *  Design: docs/superpowers/specs/2026-08-14-threshold-lines-design.md */

import type { GameEvent } from "@edh-seer/tagger";
import type { DeckCard, Hierarchy } from "./types.js";
import { producerEvents, eventMatches } from "./edges.js";
import { normalizeZoneEvent } from "./zones.js";

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

/** The zone-transition verbs -- the same four `sentence.ts`'s `VERB_PHRASES` table treats as a
 *  family (enters, enters-graveyard, dies, leaves), out of the 23-member `Verb` vocabulary in
 *  schema.ts. A card entering or leaving a zone is the only kind of trigger whose SUBJECT type is a
 *  count of "how many are in this zone" -- a phase trigger (`upkeep`, `end-step`, `begin-combat`) or
 *  a state trigger (`attacks`, `taps`, `cast`) names a type for a wholly different reason (who is
 *  attacking, what was cast), not a zone population, and reading its type as the threshold's resource
 *  is a wrong sentence: design §6.1 rule 2. */
const ZONE_EVENT_VERBS: ReadonlySet<string> = new Set(["enters", "enters-graveyard", "dies", "leaves"]);

function isZoneEventTrigger(trigger: Record<string, any>): boolean {
  const verbs: unknown[] = Array.isArray(trigger.verbs) ? trigger.verbs : [];
  return verbs.some((v) => typeof v === "string" && ZONE_EVENT_VERBS.has(v));
}

/** What the threshold counts. A counter is exact; a zone-event trigger's type/subtype names its
 *  population (Field of the Dead's `enters` + 7 is LANDS). A non-zone-event trigger's type/subtype
 *  names something else entirely and is refused, not read -- Emeritus of Abundance's `attacks`
 *  trigger carries `type:creature` but counts LANDS ("if you control eight or more lands"), and
 *  Persistent Marshstalker's `attacks` trigger carries `subtype:rat` but counts CARDS IN GRAVEYARD.
 *  Both were false resources under a rule that ignored what kind of trigger it was reading (finding
 *  1, 2026-08-14 review). An anchor whose resource cannot be named cannot have its suppliers
 *  identified either, and a piece set built from unidentified suppliers is a confidently wrong
 *  answer. */
function resourceOf(trigger: Record<string, any>): Resource | undefined {
  const s = trigger.subject ?? {};
  if (typeof s.counter === "string" && s.counter) return { kind: "counter", name: s.counter };
  if (!isZoneEventTrigger(trigger)) return undefined;
  const type = Array.isArray(s.type) ? s.type[0] : s.type;
  if (typeof type === "string" && type) return { kind: "type", name: type };
  const sub = Array.isArray(s.subtype) ? s.subtype[0] : s.subtype;
  if (typeof sub === "string" && sub) return { kind: "type", name: sub };
  return undefined;
}

/** Effect kinds that can plausibly increase how many of a TYPE resource exist. A `pump` or `damage`
 *  effect never does, however precisely its subject names the type -- finding 2 (2026-08-14 review):
 *  Gratuitous Violence ("it deals double that damage instead") is a `pump{type:creature}` amplifier
 *  that doubles DAMAGE, and Surgehacker Mech's `damage{type:[creature,planeswalker]}` amount "twice
 *  the number of Vehicles" is the same shape -- both were false amplifiers under a type-only match
 *  that never asked whether the effect grows a COUNT. Measured over the derived corpus: no
 *  `token-generation` or `counter-placement` effect currently carries both a multiplicative amount
 *  AND a type-resource subject, so this allowlist refuses every type-resource amplifier line found
 *  today -- the honest answer given what the corpus actually has, not a workaround for it. A counter
 *  resource is unaffected by this list: it is matched on `effect.subject.counter`, already exact
 *  regardless of kind (Calendar's amplifier is a `pump` effect on `counter:time`, and that IS the
 *  real thing -- restricting counter resources the same way would lose the headline witness). */
const TYPE_AMPLIFIER_KINDS: ReadonlySet<string> = new Set(["counter-placement", "token-generation"]);

/** Does this ability's effect act on the line's resource? A counter resource is matched on the
 *  effect subject's own counter field, which is how `pump{counter:time}` is told from a P/T pump. A
 *  type resource additionally requires an effect kind that can grow a count (`TYPE_AMPLIFIER_KINDS`
 *  above). */
function actsOnResource(ability: Record<string, any>, resource: Resource): boolean {
  const s = ability.effect?.subject ?? {};
  if (resource.kind === "counter") return s.counter === resource.name;
  if (!TYPE_AMPLIFIER_KINDS.has(String(ability.effect?.kind ?? ""))) return false;
  const type = Array.isArray(s.type) ? s.type : [s.type];
  return type.includes(resource.name);
}

/** The anchor's own trigger, normalized into the demand event(s) a producer must satisfy -- exactly
 *  what `directedReasons` builds for a consumer in edges.ts. Reused here rather than reinvented
 *  (design §5.2): the anchor's trigger already IS the demand, so there is no need to build a second,
 *  synthetic one out of `Resource`. */
function demandEventsOf(trigger: Record<string, any>): GameEvent[] {
  const verbs: any[] = Array.isArray(trigger.verbs) ? trigger.verbs : [];
  return verbs.map((v) => normalizeZoneEvent({ verb: v, subject: trigger.subject }));
}

/** Does this specific ability's own emit satisfy the anchor's demand? Used only to read the
 *  ability's `amount` for the growth/base model -- a `GameEvent` carries no amount, so the numeric
 *  read stays ability-scoped even though supplier PIECE membership (below) is card-scoped and reads
 *  every implied/derived event `producerEvents` can produce (a vanilla land's ETB, an implied
 *  untyped proliferate counter-added). Same primitives (`normalizeZoneEvent` + `eventMatches`), just
 *  applied at the ability's own emits rather than the card's merged producer events. */
function abilitySuppliesDemand(ability: Record<string, any>, demandEvents: GameEvent[], h: Hierarchy): boolean {
  for (const e of ability.emits ?? []) {
    const ne = normalizeZoneEvent(e);
    if (demandEvents.some((t) => eventMatches(ne, t, h))) return true;
  }
  return false;
}

export interface DetectLinesResult { lines: Line[]; refusals: Record<string, number> }

export function detectLines(deck: readonly DeckCard[], hierarchy: Hierarchy): DetectLinesResult {
  const lines: Line[] = [];
  // Design §6.1/§7: a refused anchor is not silent. `no-resource` is the only refusal that drops an
  // anchor before it ever becomes a Line, so it is the only one that needs its own tally --
  // everything else (assumed-base-1, unknown-growth, no-terminal) rides on the Line it belongs to.
  const refusalTally: Record<string, number> = {};
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
      if (!resource) { refusalTally["no-resource"] = (refusalTally["no-resource"] ?? 0) + 1; continue; }

      const siblings = abilities.filter((x) => triggerKey(x.trigger) === key);
      const terminal = siblings.map((x) => String(x.effect?.kind ?? "")).find((k) => k !== "");
      const demandEvents = demandEventsOf(a.trigger);

      const pieces: Piece[] = [{ card: dc.card.name, role: "anchor" }];
      // Untap-shaped activation supply (`untap`, `extra-turn`, an untap-bearing `extra-phase`) is
      // only a real piece of the line when the line actually needs an untap -- an anchor's own
      // trigger carries no cost, so today that means the amplifier's `{T}` (§6.4, finding 3). The
      // amplifier can turn up on a card scanned AFTER the untap piece in this same loop, so the gate
      // can't be applied inline; candidates are collected here and spliced into `pieces` only once
      // `needsUntap` is known. Copy supply (Gogo) needs no untap at all and is pushed straight into
      // `pieces`, ungated.
      const untapSupplyPieces: Piece[] = [];
      let growth: Growth = { kind: "unknown" };
      let base = 0;
      let needsUntap = typeof a.cost === "string" && a.cost.includes("{T}");

      for (const other of deck) {
        const otherAbilities = (other.tags?.abilities ?? []) as unknown as Record<string, any>[];
        const producerEvts = other.tags ? producerEvents(other.tags) : [];

        // Suppliers: reuse the engine's own event matching instead of a synthetic demand built from
        // the Resource (design §5.2, and the fix for a measured bug -- the old resource-field check
        // found 15 of 44 real Field of the Dead suppliers on a calibration deck, missing every
        // vanilla land, because a land has no Ability and its "a land entered" fact lives only in
        // `impliedEvents` inside `producerEvents`; it also missed a bare `proliferate` emit, whose
        // implied counter-added carries no counter kind and is matched by `counterAddMatches`'s
        // wildcard against a SPECIFIC counter demand).
        if (demandEvents.some((t) => producerEvts.some((pe) => eventMatches(pe, t, hierarchy)))) {
          // The anchor legitimately supplies its own threshold (Calendar's accumulator supplies
          // Calendar's own trigger). Tagged "anchor", not a second "supplier" role for the same card
          // -- it already got the anchor piece above, so this can't double it up under two roles.
          pieces.push({ card: other.card.name, role: other === dc ? "anchor" : "supplier" });
        }

        for (const b of otherAbilities) {
          if (actsOnResource(b, resource) && b !== a) {
            const g = classifyGrowth(b.amount);
            if (g.kind === "multiplicative" && growth.kind !== "multiplicative") {
              growth = g;
              pieces.push({ card: other.card.name, role: "amplifier" });
              if (typeof b.cost === "string" && b.cost.includes("{T}")) needsUntap = true;
            }
          }
          if (abilitySuppliesDemand(b, demandEvents, hierarchy)) {
            const g = classifyGrowth(b.amount);
            if (g.kind === "additive") base = Math.max(base, g.step);
            if (growth.kind === "unknown") growth = g;
          }
          // Activation supply. `untap` and `extra-turn` count unconditionally; `extra-phase` counts
          // ONLY when the phase it grants itself carries an untap step (`UNTAP_PHASES`) -- Sphinx of
          // the Second Sun's `beginning` does, The Ninth Doctor/Obeka/Paradox Haze's `upkeep` does
          // not, and the phase is recorded on the piece so a reader can tell why.
          const kind = String(b.effect?.kind ?? "");
          if (kind === "extra-phase") {
            const phase = b.effect?.subject?.phase;
            if (typeof phase === "string" && UNTAP_PHASES.has(phase)) {
              untapSupplyPieces.push({ card: other.card.name, role: "extra-phase", phase });
            }
          } else {
            const role = SUPPLY_ROLE[kind];
            if (role) untapSupplyPieces.push({ card: other.card.name, role });
          }
          // Gogo: a copier is activation supply that needs no untap at all. Named by KIND and a
          // non-fixed amount, and marked unproven -- `effect.subject` is absent because no
          // SubjectFilter can name an ability, so nothing here proves it copies THIS one.
          if (b.effect?.kind === "clone" && classifyGrowth(b.amount).kind === "unknown") {
            pieces.push({ card: other.card.name, role: "copy", unproven: true });
          }
        }
      }

      // Finding 3: an anchor whose amplifier costs no `{T}` needs no untap supply at all, and the
      // untap-shaped candidates collected above simply don't enter the piece set (design §6.4's
      // closing rule -- Colfenor's Urn, a triggered end-step ability with no cost, and Field of the
      // Dead, whose token-generation trigger has no amplifier, both needed this; both were carrying
      // an untap piece unconditionally before this gate existed).
      if (needsUntap) pieces.push(...untapSupplyPieces);

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
  return { lines, refusals: refusalTally };
}
