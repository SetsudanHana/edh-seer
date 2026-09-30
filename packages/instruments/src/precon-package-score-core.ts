/** PRECON PACKAGE SCORE, THE PURE HALF (#767; measures PRE-REGISTERED 2026-09-30 in
 *  `docs/plans/2026-09-30-precon-upgrade-package.md`, before any package code existed).
 *
 *  A failed measure is recorded as failed. Nothing here is loosened after a run.
 *
 *  Hard, 100% or the instrument exits 1:
 *    H1  every package's finished deck sits in its target's band;
 *    H2  every swap has a non-empty reason on both sides, at most `REASON_MAX` characters;
 *    H3  an add is in the index, inside the identity and not already in the deck; the commander is
 *        never cut; no card is cut or added twice in one package;
 *    H4  a role swap's add fills every build role the cut fills, and is strictly better on the
 *        section's role, recomputed here, independently of the code that chose it;
 *    H5  the mana base total after the package is not worse than before.
 *  Soft, recorded, and a miss blocks shipping until the owner rules:
 *    S1  at least 90% of precons have 5 or more swaps at every target;
 *    S2  the target-3 package keeps the synergy score in at least 18 of the 20 sampled precons. */
import type { Ingredient, Ingredients } from "@edh-seer/matcher/quality";
import { bandFits, type BracketTarget, type UpgradePackage, type UpgradeSwap } from "@edh-seer/matcher/upgrade-package";

export type Band = "1-2" | "3" | "4-5";
export type HardMeasure = "H1" | "H2" | "H3" | "H4" | "H5";
export interface Violation { measure: HardMeasure; target: BracketTarget; detail: string }

export const REASON_MAX = 160;
export const S1_FLOOR = 0.9;
export const S1_SWAPS = 5;
export const S2_SAMPLE = 20;
export const S2_EVERY = 9;
export const S2_KEPT = 18;

/** THE DIRECTION OF EACH MEASURE `quality.ts` reads: lower is better for these, higher for the rest. */
const LOWER_IS_BETTER: ReadonlySet<Ingredient> = new Set(["manaValue", "drawback", "restriction"]);

/** STRICTLY BETTER (owner, 2026-09-30). Both cards must carry `manaValue` and `timing`. A measure
 *  only the cut carries means the two cannot be compared, so the swap is not strictly better. The
 *  add must be at least as good on every measure both carry and better on at least one. */
export function strictlyBetter(cut: Ingredients, add: Ingredients): { ok: boolean; gained: Ingredient[] } {
  if (cut.manaValue === undefined || cut.timing === undefined || add.manaValue === undefined || add.timing === undefined) return { ok: false, gained: [] };
  const gained: Ingredient[] = [];
  for (const k of Object.keys(cut) as Ingredient[]) {
    const c = cut[k];
    const a = add[k];
    if (c === undefined) continue;
    if (a === undefined) return { ok: false, gained: [] };
    const better = LOWER_IS_BETTER.has(k) ? a < c : a > c;
    const worse = LOWER_IS_BETTER.has(k) ? a > c : a < c;
    if (worse) return { ok: false, gained: [] };
    if (better) gained.push(k);
  }
  return { ok: gained.length > 0, gained };
}

export const swapsOf = (p: UpgradePackage): UpgradeSwap[] => [...p.bringDown, ...p.sections.flatMap((s) => s.swaps)];

/** What the checks need to know about one package, gathered by the runner. */
export interface PackageFacts {
  commanders: readonly string[];
  deck: ReadonlySet<string>;
  identity: ReadonlySet<string>;
  /** The add's colour identity, or `null` when the name index has no such card. */
  identityOf: (name: string) => readonly string[] | null;
  bandAfter: Band;
  manaBefore: number;
  manaAfter: number;
  /** For each role swap: the build roles of each side, and their ingredients in the swap's role. */
  role: (swap: UpgradeSwap) => { cutRoles: readonly string[]; addRoles: readonly string[]; cut: Ingredients; add: Ingredients } | null;
}

export function hardViolations(pkg: UpgradePackage, f: PackageFacts): Violation[] {
  const out: Violation[] = [];
  const v = (measure: HardMeasure, detail: string) => out.push({ measure, target: pkg.target, detail });
  if (!bandFits(f.bandAfter, pkg.target)) v("H1", `ends in band ${f.bandAfter}`);
  const cut = new Set<string>();
  const added = new Set<string>();
  for (const s of swapsOf(pkg)) {
    for (const side of [s.out, s.in]) {
      if (!side.reason.trim()) v("H2", `${side.name}: no reason`);
      else if (side.reason.length > REASON_MAX) v("H2", `${side.name}: reason is ${side.reason.length} characters`);
    }
    const id = f.identityOf(s.in.name);
    if (!id) v("H3", `${s.in.name} is not in the name index`);
    else if (!id.every((c) => f.identity.has(c))) v("H3", `${s.in.name} is outside the identity`);
    if (f.deck.has(s.in.name)) v("H3", `${s.in.name} is already in the deck`);
    if (f.commanders.includes(s.out.name)) v("H3", `cuts the commander ${s.out.name}`);
    if (cut.has(s.out.name)) v("H3", `${s.out.name} is cut twice`);
    if (added.has(s.in.name)) v("H3", `${s.in.name} is added twice`);
    cut.add(s.out.name);
    added.add(s.in.name);
    if (s.kind === "role") {
      const r = f.role(s);
      if (!r) { v("H4", `${s.out.name} -> ${s.in.name}: roles unreadable`); continue; }
      const lost = r.cutRoles.filter((x) => !r.addRoles.includes(x));
      if (lost.length) v("H4", `${s.out.name} -> ${s.in.name}: loses ${lost.join(", ")}`);
      if (!strictlyBetter(r.cut, r.add).ok) v("H4", `${s.out.name} -> ${s.in.name}: not strictly better as ${s.role}`);
    }
  }
  if (f.manaAfter > f.manaBefore) v("H5", `mana base ${f.manaBefore} -> ${f.manaAfter}`);
  return out;
}

/** S1: the share of precons with at least `S1_SWAPS` swaps at every target they were given. A
 *  precon with no packages at all counts as a miss, which is the baseline. */
export function s1Share(pages: readonly { packages?: readonly UpgradePackage[] }[]): number {
  if (pages.length === 0) return 0;
  const enough = pages.filter((p) => (p.packages?.length ?? 0) > 0 && p.packages!.every((k) => swapsOf(k).length >= S1_SWAPS));
  return enough.length / pages.length;
}

/** S2's fixed sample: every `S2_EVERY`th precon in `precons.json` order, the first `S2_SAMPLE`. */
export function s2Sample<T>(precons: readonly T[]): T[] {
  return precons.filter((_, i) => i % S2_EVERY === 0).slice(0, S2_SAMPLE);
}

/** S2: how many sampled precons kept (or raised) their synergy score with the target-3 package. */
export function s2Kept(rows: readonly { before: number; after: number }[]): number {
  return rows.filter((r) => r.after >= r.before).length;
}
