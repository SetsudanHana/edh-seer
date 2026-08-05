/** One encoding per fact, settled in code after extraction.
 *
 *  Measurement said half of all residual drift between two identical runs was not the model
 *  disagreeing about what a card does — it was two spellings of the same thing. A rule belongs here
 *  only when it settles a fact the model was never entitled to choose:
 *
 *    - a clause with no actions and one recorded as [none] are the same clause;
 *    - a cast always goes to the stack, so stating it adds nothing;
 *    - the DEFAULT origin of a move is implied by the verb, so recording it is optional
 *      bookkeeping: an unstated fromZone and an explicit `library` are the same fact;
 *    - "reveal" is dropped, but not because it is never a game action — Duress and Thoughtseize
 *      reveal a hand with no search anywhere. It is dropped because exactly one card in the game
 *      (Priority Boarding) triggers off revealing, so no payoff consumes it as its own event, while
 *      the discard or draw beside it carries the edge.
 *
 *  A NON-DEFAULT origin is never normalised, because it is the whole card: `exile target card from
 *  a GRAVEYARD` is Scavenging Ooze and Bojuka Bog, `put target creature card from a GRAVEYARD onto
 *  the battlefield` is Reanimate and Necromancy, and `search your GRAVEYARD, hand, and/or library`
 *  is Boonweaver Giant. An earlier version of this dropped fromZone for put and exile outright,
 *  which split reanimation on templating alone — `return` (Animate Dead) kept its graveyard while
 *  `put` (Reanimate) lost it — and silently erased the graveyard-hate kind the vocabulary had just
 *  gained.
 *
 *  This runs in the pipeline so the derivation layer consumes one encoding, and the scorer imports
 *  the same functions so the reported numbers cannot drift from what the pipeline actually does. */

export interface Action {
  verb?: string;
  object?: string;
  fromZone?: string | null;
  toZone?: string | null;
  amount?: string | null;
  optional?: boolean;
}

export interface ClauseRecord {
  id: number;
  abilityType?: string;
  trigger?: { event?: string; subject?: string; control?: string } | null;
  actions?: Action[];
}

/** Verbs whose origin zone has an obvious default, so leaving it unstated means that default. */
const IMPLIED_ORIGIN = new Set(["put", "exile", "search", "return"]);

/** Bookkeeping that no payoff keys off as its own event. */
const DROPPED_VERBS = new Set(["reveal"]);

/** A trigger recorded as the string "none" and an absent trigger are the same fact. One encoding
 *  per fact, or two runs disagree over nothing. */
export function canonicalTrigger(t: ClauseRecord["trigger"]): ClauseRecord["trigger"] | undefined {
  if (!t || t.event === "none" || t.event === undefined) return undefined;
  return t;
}

export function canonicalAction(a: Action): Action {
  const zone = a.fromZone ?? "";
  const impliedOrigin = IMPLIED_ORIGIN.has(a.verb ?? "") && (zone === "" || zone === "library");
  return {
    ...a,
    fromZone: impliedOrigin ? null : a.fromZone ?? null,
    toZone: a.verb === "cast" ? null : a.toZone ?? null,
  };
}

/** The actions a clause states, in one encoding. Order is preserved: it is data, not spelling. */
export function canonicalActions(actions: Action[] | undefined): Action[] {
  const kept = (actions ?? []).filter((a) => !DROPPED_VERBS.has(a.verb ?? "")).map(canonicalAction);
  return kept.length ? kept : [{ verb: "none" }];
}

export function canonicalClause(c: ClauseRecord): ClauseRecord {
  const trigger = canonicalTrigger(c.trigger);
  return {
    id: c.id,
    ...(c.abilityType ? { abilityType: c.abilityType } : {}),
    ...(trigger ? { trigger } : {}),
    actions: canonicalActions(c.actions),
  };
}

export function canonicalize(clauses: ClauseRecord[] | undefined): ClauseRecord[] {
  return (clauses ?? []).map(canonicalClause);
}

/** Comparison key for a canonicalised clause list — what the derivation layer actually consumes:
 *  which verbs and zone transitions each clause contains. */
export function canonicalSignature(clauses: ClauseRecord[] | undefined): string {
  return JSON.stringify(canonicalize(clauses).map((c) => [
    c.id, c.abilityType ?? undefined, c.trigger?.event ?? null,
    [...new Set((c.actions ?? []).map((a) => `${a.verb}|${a.fromZone ?? ""}|${a.toZone ?? ""}`))].sort(),
  ]));
}
