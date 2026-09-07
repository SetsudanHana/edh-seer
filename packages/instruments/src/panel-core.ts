/** The frozen panel: a fixed set of card PAIRS whose claims carry permanent verdicts.
 *
 *  Why this exists (`docs/superpowers/specs/2026-08-05-edge-precision-measurement-design.md` §23):
 *  fresh sampling cannot track the changes being made to this engine. At n=150 an arm's 95% interval
 *  is 12–16 points wide, and a 2–5% change to the reason population moves precision by 1–3 points, so
 *  three consecutive draws all read "no measurable change" and a fourth read a 6-point move on a
 *  population NOTHING had touched. Each draw resamples everything, so the noise is redrawn every time.
 *
 *  A panel holds the population fixed instead. The same pairs are re-scored after every change, so a
 *  difference is PAIRED and the sampling noise mostly cancels — the comparison is "did these claims
 *  get better", not "are these two random samples different".
 *
 *  Two things make it survive changes in BOTH directions, which is where `precision-recheck` stops
 *  (its warrant holds only while the population shrinks):
 *    - the unit is the PAIR, so a change that alters which claims a pair produces does not invalidate
 *      the panel; it just changes what needs looking up.
 *    - a verdict is cached per CLAIM and never expires, so removals cost nothing and additions cost
 *      only the additions. That cost is reported as `unjudged` — the judging DEBT — and a change that
 *      adds claims cannot silently inflate precision, because unjudged claims are owed, not real. */

export type Verdict = "real" | "false" | "uncertain";

export interface PanelVerdict {
  producer: string;
  consumer: string;
  tag: string;
  verdict: Verdict;
  cause: string;
  note: string;
  /** WHICH MECHANISM this verdict was made against. A claim's `producer|consumer|tag` is NOT its
   *  identity: the same triple can be asserted through an authored ability one day and through the
   *  producer's own entry the next, and a verdict made against the first then scores the second.
   *
   *  Measured (Fable review, 2026-08-15): Goldspan Dragon -> Terror of the Peaks was cached `real`
   *  for the right reason, the 2026-08-07 re-judge overturned it to `false` reading Goldspan's
   *  TREASURE ability, and round 3 then drew that stale `false` against a claim asserting Goldspan's
   *  own ENTRY. Origin of Metalbending -> Leyline of Resonance has the identical history. Those
   *  became 2 of the 11 disagreements that kept precision withdrawn.
   *
   *  BACKWARD COMPATIBLE ON PURPOSE. Absent — which every verdict written before today is — means
   *  "not recorded", and the claim scores exactly as it did before. A verdict that DOES carry it and
   *  disagrees with the live claim is treated as UNJUDGED, so the mismatch surfaces as judging debt
   *  instead of a silently wrong score. Protection accrues to new verdicts rather than invalidating
   *  1,661 old ones. */
  implied?: boolean;
}

/** One claim as the engine currently states it. */
export interface PanelClaim {
  producer: string;
  consumer: string;
  tag: string;
  /** The producer supplies this event merely BY BEING ITSELF — a creature entering, an instant being
   *  cast — rather than through an authored ability. Carried so a worksheet can SAY so: three of the
   *  four claims Claude wrongly judged false in the agreement draw were this shape. */
  implied?: boolean;
}

export interface PanelScore {
  real: number;
  false: number;
  uncertain: number;
  /** Claims the engine makes today that no verdict covers. The debt to pay before the next reading. */
  unjudged: PanelClaim[];
  /** The claims judged FALSE, with the note they were judged under. The precision headline says how
   *  many there are; this says WHICH, which is the only form the number is actionable in. Kept here
   *  rather than re-derived at a call site because the cache lookup is exact-then-wildcard and
   *  re-implementing it is how a reader ends up measuring something adjacent to the panel. Roadmap
   *  C7 was a HAND-TRANSCRIBED version of this list and went stale by 41 claims in two days. */
  falses: { claim: PanelClaim; note: string }[];
  /** Cached verdicts the engine no longer claims. Kept, not deleted: the change may be reverted.
   *
   *  ON ITS OWN THIS NUMBER READS AS ATTRITION AND MOSTLY IS NOT. Measured 2026-09-07: 704 dropped,
   *  147 of them judged REAL, and splitting those by hand gave 89 retags, 8 rotted verdicts and 50
   *  genuine regressions. The three fields below are that split. */
  dropped: number;
  /** A dropped claim the panel had judged FALSE. THIS IS THE GATES WORKING, not attrition: on the
   *  2026-09-07 reading it was 528 of the 704, and counting it beside the losses is what made the
   *  headline number unreadable. Every field below counts only claims judged REAL. */
  droppedFalse: number;
  /** A dropped claim the panel judged UNCERTAIN. Counted apart from `droppedFalse`, because
   *  uncertain is not wrong: folding the two together overstated the win by 29 on the real panel
   *  and the runner printed all 557 as "judged FALSE". */
  droppedUncertain: number;
  /** Dropped because the TAG was renamed while the pair still joins (`cast:artifact` ->
   *  `cast:spell`, `enters:any` -> `enters:permanent`). Not a loss, and it must not cost recall. */
  droppedRetag: number;
  /** Dropped because the pair no longer joins at all: `droppedRot + droppedRegression`. */
  droppedLost: number;
  /** A lost pair naming a card that is no longer in its deck. NOT a regression -- on the live panel
   *  every one of these was the RESOLVER being fixed, not the engine losing an edge. Always 0 unless
   *  the caller supplies `pairInDeck`, because nothing in this file can see a decklist. */
  droppedRot: number;
  /** A lost pair the engine STILL CLAIMS, through a token node one SIDE of the pair creates.
   *  `Oath of Liliana -> Ayara` became `Oath -> Zombie [token] -> Ayara`: Ayara triggers on a black
   *  creature entering, Oath is an ENCHANTMENT and never enters as one, and the relation belongs to
   *  the token. The mirror case is the CONSUMER's demand moving: `Vivi's Persistence` is not the
   *  payoff, the 0/1 Wizard it creates is, and the Wizard carries "whenever you cast a noncreature
   *  spell". Same claim either way, said more precisely. Counted as HELD by recall, because the
   *  engine has not stopped saying these two cards work together. */
  droppedReattributed: number;
  /** A lost pair whose two cards are both still in the deck and which nothing re-attributes.
   *  The only bucket that is a defect. */
  droppedRegression: number;
  /** Pairs carrying at least one REAL verdict that the engine still joins, and those it does not.
   *  Rotted pairs are in neither: a verdict about a card that is not in the deck is not a recall
   *  opportunity. PAIR-LEVEL because the panel's unit is the pair -- a pair with three REAL claims
   *  that keeps one is held, not two thirds lost. */
  recallHeld: number;
  recallLost: number;
  /** The lost pairs BY NAME (`producer|consumer`), sorted. The count alone lets one loss hide
   *  behind one gain, which is what `compare by NAME, not by count` exists to prevent. */
  lostPairs: string[];
  /** `recallHeld / (recallHeld + recallLost)`, or null when the panel offers no REAL pair to hold.
   *
   *  THE PANEL REPORTED PRECISION AND NOTHING ELSE UNTIL 2026-09-07, and precision alone cannot be
   *  compared across a change that shrinks the claim set: the engine claimed 420 of 1,121 judged
   *  claims that day and read 99.0%, against 92.9% recorded a fortnight earlier on a set nearly
   *  three times larger. A gate that deletes every claim it is unsure of scores 100%. */
  recall: number | null;
  precision: number | null;
}

/** A claim's identity. Directed, because `directedReasons` is: "A supplies B" and "B supplies A" are
 *  different assertions and were judged separately. */
export function claimKey(producer: string, consumer: string, tag: string): string {
  return `${producer}|${consumer}|${tag}`;
}

/** Does this verdict come from the OWNER? The panel's authority order, stated once: the user judges,
 *  Claude proposes. `panel-score.ts --rejudge` already excludes these rows for the same reason —
 *  re-judging them would overwrite the answer with the thing being tested. */
const isUserVerdict = (v: PanelVerdict): boolean => v.note.startsWith("USER VERDICT");

/** Fold new verdicts over old. Later wins, so a corrected judgment supersedes without the caller
 *  having to find and delete the original — 17 of the first 600 rows needed exactly that.
 *
 *  EXCEPT THAT A USER VERDICT IS NEVER OVERWRITTEN BY A CLAUDE ONE, whatever the order. Measured on
 *  the cache 2026-08-20: of 64 claims whose duplicate rows DISAGREE, **44 are exactly this shape** —
 *  the owner overriding an earlier Claude verdict, with notes that say so ("OVERRIDES Claude's cached
 *  false"). Order alone carried that rule, which is why `panel-build.ts` and the raw file disagreed
 *  on 8 claims and read 92.0% against 93.8%: the file is in append order, a rebuild is in source
 *  order. Encoding the authority makes the merge insensitive to order for those 44; the remaining 20
 *  (17 Claude-vs-Claude, 3 owner-vs-owner) are genuine chronology and are settled ONCE by
 *  de-duplicating the cache in append order. */
/** The key a verdict is DEDUPED on, which is not the key it is looked up by.
 *
 *  `implied` marks the mechanism the verdict was made against — a producer supplying an event by
 *  BEING itself, rather than through an authored ability — and `scorePanel` owes the claim again
 *  when the two disagree. So two rows sharing a triple but differing on `implied` are verdicts about
 *  DIFFERENT THINGS and both must survive; collapsing them cost two judged claims the first time
 *  this dedupe was attempted (Hornet Nest -> Enduring Innocence, Aragorn -> Prowl), each of which
 *  had an owner verdict on the authored mechanism and a Claude verdict on the implied one.
 *
 *  A row with no `implied` at all is the wildcard the field's absence has always meant, and keeps its
 *  own slot. */
export const verdictKey = (v: PanelVerdict): string =>
  `${claimKey(v.producer, v.consumer, v.tag)}|${v.implied === undefined ? "*" : v.implied}`;

export function mergeVerdicts(
  existing: readonly PanelVerdict[],
  incoming: readonly PanelVerdict[],
): PanelVerdict[] {
  const by = new Map<string, PanelVerdict>();
  for (const v of existing) by.set(verdictKey(v), v);
  for (const v of incoming) {
    const k = verdictKey(v);
    const held = by.get(k);
    if (held && isUserVerdict(held) && !isUserVerdict(v)) continue;
    by.set(k, v);
  }
  return [...by.values()];
}

export function scorePanel(
  current: readonly PanelClaim[],
  cache: readonly PanelVerdict[],
  /** Are both of this pair's cards still in the deck the panel drew it from? Injected because
   *  `panel-core` never reads a decklist. Absent, every lost pair counts as a regression -- the
   *  conservative direction, since it can only over-report loss. */
  pairInDeck?: (producer: string, consumer: string) => boolean,
  /** Does the engine still make this claim through an intermediate it creates? Injected for the
   *  same reason as `pairInDeck`: answering it needs a scored deck, which this file never sees. */
  reattributed?: (producer: string, consumer: string, tag: string) => boolean,
): PanelScore {
  // LOOKUP AS PRECISE AS STORAGE. A verdict is stored per MECHANISM (`implied`), so consulting the
  // cache by triple alone made the score depend on which row happened to sit LAST in the file — the
  // same claim reading 93.6% or 94.3% purely from row order, which is what made a rebuild unsafe to
  // run. The exact mechanism wins; a row with no `implied` is the wildcard its absence has always
  // meant and is the fallback.
  const exact = new Map<string, PanelVerdict>();
  const wildcard = new Map<string, PanelVerdict>();
  for (const v of cache) {
    const k = claimKey(v.producer, v.consumer, v.tag);
    if (v.implied === undefined) wildcard.set(k, v);
    else exact.set(`${k}|${v.implied}`, v);
  }
  const seen = new Set<string>();
  const out: PanelScore = {
    real: 0, false: 0, uncertain: 0, unjudged: [], falses: [], dropped: 0, droppedFalse: 0,
    droppedRetag: 0, droppedLost: 0, droppedRot: 0, droppedReattributed: 0, droppedRegression: 0,
    droppedUncertain: 0, recallHeld: 0, recallLost: 0, lostPairs: [], recall: null, precision: null,
  };
  for (const c of current) {
    const k = claimKey(c.producer, c.consumer, c.tag);
    seen.add(k);
    const v = exact.get(`${k}|${c.implied === true}`) ?? wildcard.get(k);
    if (!v) { out.unjudged.push(c); continue; }
    if (v.verdict === "real") out.real++;
    else if (v.verdict === "false") { out.false++; out.falses.push({ claim: c, note: v.note }); }
    else out.uncertain++;
  }
  // "Cached verdicts the engine no longer claims" counts CLAIMS, so it counts distinct triples
  // across both maps — a claim with a verdict for each mechanism is one dropped claim, not two.
  const cachedClaims = new Set([...wildcard.keys(), ...[...exact.keys()].map((k) => k.slice(0, k.lastIndexOf("|")))]);
  const dropped = [...cachedClaims].filter((k) => !seen.has(k));
  out.dropped = dropped.length;

  // WHICH PAIRS THE ENGINE STILL JOINS, under any tag. This is the whole difference between a retag
  // and a loss, and the panel could not tell them apart before because it only ever compared triples.
  const pairKey = (producer: string, consumer: string): string => `${producer}|${consumer}`;
  const joined = new Set(current.map((c) => pairKey(c.producer, c.consumer)));
  const family = (t: string): string => t.split(":")[0];
  /** Which tag FAMILIES the engine still joins each pair on. */
  const joinedFamilies = new Map<string, Set<string>>();
  for (const c of current) {
    const k = pairKey(c.producer, c.consumer);
    if (!joinedFamilies.has(k)) joinedFamilies.set(k, new Set());
    joinedFamilies.get(k)!.add(family(c.tag));
  }
  /** A pair is only HELD by a live claim the panel BELIEVES: judged real, or not yet judged (which
   *  is debt, already reported on its own line). A live claim judged uncertain or false is not the
   *  edge coming back -- measured: 5 pairs were held by an uncertain claim alone. */
  const believable = new Set<string>();
  for (const c of current) {
    const k = claimKey(c.producer, c.consumer, c.tag);
    const v = exact.get(`${k}|${c.implied === true}`) ?? wildcard.get(k);
    if (!v || v.verdict === "real") believable.add(pairKey(c.producer, c.consumer));
  }
  const rotted = (producer: string, consumer: string): boolean =>
    pairInDeck !== undefined && !pairInDeck(producer, consumer);

  // SPLIT BY WHAT THE VERDICT SAID FIRST. A dropped claim the panel judged FALSE is a claim the
  // engine stopped making wrongly -- the entire point of every gate shipped since the panel froze --
  // and folding it in with the losses is how 704 came to read as attrition when 528 of it was a win.
  for (const k of dropped) {
    const v = exact.get(`${k}|true`) ?? exact.get(`${k}|false`) ?? wildcard.get(k);
    if (v && v.verdict === "false") { out.droppedFalse++; continue; }
    if (v && v.verdict === "uncertain") { out.droppedUncertain++; continue; }
    const [producer, consumer, tag] = k.split("|");
    // SAME FAMILY ONLY. `cast:artifact` -> `cast:spell` is a rename of one relation;
    // `static:pump` -> `enters:creature` is a DIFFERENT relation wearing the same pair, and 15 of
    // the 89 "retags" crossed families on the real panel.
    if ((joinedFamilies.get(pairKey(producer, consumer)) ?? new Set()).has(family(tag))) {
      out.droppedRetag++; continue;
    }
    out.droppedLost++;
    if (rotted(producer, consumer)) out.droppedRot++;
    else if (reattributed?.(producer, consumer, k.slice(k.lastIndexOf("|") + 1))) out.droppedReattributed++;
    else out.droppedRegression++;
  }

  // Recall over pairs the panel judged REAL at least once. Read off the CACHE rather than off
  // `dropped`, because a pair can be held by a claim that is itself unjudged -- which is exactly
  // what a retag produces, and counting it as lost would re-create the number this replaces.
  const realPairs = new Set<string>();
  for (const v of cache) {
    if (v.verdict !== "real") continue;
    if (rotted(v.producer, v.consumer)) continue;
    realPairs.add(pairKey(v.producer, v.consumer));
  }
  // A re-attributed claim is HELD. The engine still says the two cards work together; it just
  // names the token that carries the relation. Scoring that as a loss would push the measure toward
  // a cruder model, which is the opposite of what it is for.
  const stillClaimed = new Map<string, boolean>();
  for (const v of cache) {
    if (v.verdict !== "real") continue;
    const k = pairKey(v.producer, v.consumer);
    if (believable.has(k)) { stillClaimed.set(k, true); continue; }
    if (reattributed?.(v.producer, v.consumer, v.tag)) stillClaimed.set(k, true);
    else if (!stillClaimed.has(k)) stillClaimed.set(k, false);
  }
  for (const k of realPairs) {
    if (stillClaimed.get(k)) out.recallHeld++;
    else { out.recallLost++; out.lostPairs.push(k); }
  }
  out.lostPairs.sort();
  const opportunities = out.recallHeld + out.recallLost;
  if (opportunities > 0) out.recall = out.recallHeld / opportunities;

  const decided = out.real + out.false;
  if (decided > 0) out.precision = out.real / decided;
  return out;
}

/** 95% Wilson interval, in percent. Same estimator as `precision-core.wilson`, restated in percent
 *  here so the panel report reads without a conversion step at the call site. */
export function wilsonPanel(successes: number, total: number): [number, number] {
  if (total === 0) return [0, 100];
  const z = 1.959964;
  const p = successes / total;
  const denom = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const spread = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return [Math.max(0, ((centre - spread) / denom) * 100), Math.min(100, ((centre + spread) / denom) * 100)];
}

/** THE PANEL'S GUARD IS A NAMED SET, not a percentage.

 *  `derive-compass.test.ts` asserts `expect(regressions).toEqual([])` and `pair-calibration.test.ts`
 *  caps quarantined defects AND fails when a quarantined pair starts agreeing. This is the same
 *  shape for the 895-pair panel: a percentage floor would let one lost edge hide behind one
 *  recovered edge, and the number would sit still while the contents rotted.
 *
 *  BOTH DIRECTIONS ARE FAILURES. `added` is a pair nobody has accepted losing. `recovered` is an
 *  improvement the list has not been updated for -- unbanked, so the next regression could spend it
 *  invisibly. */
export function ratchetLostPairs(
  lostNow: readonly string[],
  known: readonly string[],
): { added: string[]; recovered: string[] } {
  const now = new Set(lostNow);
  const before = new Set(known);
  return {
    added: [...now].filter((p) => !before.has(p)).sort(),
    recovered: [...before].filter((p) => !now.has(p)).sort(),
  };
}
