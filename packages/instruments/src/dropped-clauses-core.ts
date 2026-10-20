/** PURE CORE of the dropped-clause ratchet (#1299). A clause is DROPPED when derive read it as having
 *  at least one real action and then produced no ability that carries its clause id: the grammar's
 *  `complete: true` means "parsed", not "derive can express it", and nothing else reports the gap.
 *
 *  Keyed BY CARD: a sorted list of `<clause id>:<verb>`, with `:<from>><to>` appended when the action
 *  states a zone. The zone is in the key because the census shape is (verb, from>to) -- `put library>hand`
 *  and `put hand>battlefield` are different defects -- and it keeps a line one action, so a fix is a
 *  one-line diff. A clause id is the segmenter's, so it moves when a card is re-segmented, which is a
 *  change worth seeing anyway.
 *
 *  INERT ACTIONS are not drops: a verb in `INERT_VERBS` (derive.ts, "state no action at all") never counts.
 *
 *  EXCLUDED, because the clause has an explicit home elsewhere:
 *   1. GRANTED TO THE CARD'S OWN TOKEN OR EMBLEM (`grantedTokenClauses`): derive skips the whole clause on
 *      purpose (derive.ts, `grantedToken?.has(clause.id)`) because the token's or emblem's own derived row
 *      carries both halves of the quoted ability.
 *   2. A MANA CLAUSE ON A CARD WITH `manaLines`: `ManaLine` carries no clause id (schema.ts), so the join is
 *      the best available one -- a clause that contains an `add-mana` action and whose every real action is
 *      `add-mana`, `tap` or `untap` (the mana ability and its tap riders), on a card that derived at least one
 *      mana line. A tap-only clause ("{T}: Tap target creature") and a mixed one (add-mana + draw) are NOT
 *      exempt. CEILING: card-level, not clause-level; a second, unrelated add-mana clause on the same card hides
 *      behind the first one's line. The same clause on a card with NO mana line is a drop, and is reported.
 *   3. A SPLICED TWIN: a stored record that duplicates a partner clause under another id (the model split a
 *      compound, or numbered a sentence differently from `segment()`). Derive folds it into the partner
 *      (`redundant` in derive.ts) and the ability carries the partner's id. The set of clause ids ACTUALLY spliced
 *      comes from derive's own run (`deriveAbilitiesOf(...).spliced`), never a re-implementation: a twin that was
 *      detected but kept (it said more than its partner) has its own ability and is not a drop anyway.
 *   4. A SELF "ENTERS TAPPED" STATIC on a LAND or a card with `manaLines` (Rootbound Crag, Marble Diamond): every real
 *      action is `tap` on a self object ("this land", "this", the card's own name) AND the clause text names a
 *      SELF subject entering tapped ("this <type> enters tapped", "~", "it", the card's name, after any lead-in such as a shock land's "As this land enters, you may pay 2 life. If you don't, ..."). Derive has no field
 *      for it (it reports `unclaimed {tap}`); the homes are printed-text readers: for lands `mana-base.ts`
 *      `tappedLandCount` (TAPPED) and `land-score.ts`; for mana rocks `build.ts` rock grade (`entersTappedEver` in
 *      rules.json). CEILING: covers exactly lands and mana-line cards. A creature or a non-mana artifact that enters
 *      tapped (Deep-Slumber Titan, Gutterbones) has NO reader and stays a drop, as does a global "each creature
 *      enters tapped" (Ashling's Prerogative). "tap target creature" and a cost-like "tap an untapped creature you
 *      control" are kept because their object is not self.
 *
 *   5. (Not an exclusion.) A SPLICED clause is keyed `<id>:spliced`, not skipped, so a change in splicing moves the ratchet.
 *
 *  PARTIAL DROPS (`partialKeys`): see there; keys `<id>:<verb>[:<from>><to>]:partial`.
 *
 *  KEYS REPEAT WITHIN A CARD (two identical actions in one clause give two identical keys) and the diff is
 *  SET-BASED (`diffMembership`), so a second identical drop on a card that already has one does not move it. */
import { INERT_VERBS, type ClauseRecord } from "@edh-seer/tagger";

export type Dropped = Record<string, string[]>;

const MANA_VERBS = new Set(["add-mana", "tap", "untap"]);
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export interface Homes {
  /** Clause ids some derived ability carries (`Ability.clause`). */
  abilityClauses: ReadonlySet<number>;
  /** `grantedTokenClauses(card)`. */
  granted: ReadonlySet<number>;
  /** The derived card has at least one `manaLines` entry. */
  hasManaLines: boolean;
  /** `deriveAbilitiesOf(...).spliced`: the clause ids whose ability derive actually folded into its twin partner's. */
  spliced: ReadonlySet<number | string>;
  /** The card's type line includes Land. */
  isLand: boolean;
  /** Clause id -> printed clause text (`clauseTexts(card)`). */
  texts: Readonly<Record<number, string>>;
  /** The card's own name, for a self object. */
  cardName: string;
}

const ENTERS_TAPPED = /\benters(?: the battlefield)? tapped\b/i;
const SELF_OBJECT = /^(?:this(?: [a-z]+)?|~|it)$/i;
/** The clause text says a SELF subject enters tapped: "this <type> enters (the battlefield) tapped", "~ ...", "it enters tapped" (the
 *  shock land's "If you don't, it enters tapped", a snarl's "this land enters tapped"), or the card's own name (any face of a DFC), after any
 *  lead-in ("As this land enters, you may pay 2 life. If you don't, ..."). Fixed alternation, linear. Ashling's Prerogative's "Each creature ...
 *  enters tapped" names no self subject and never matches. */
const SELF_ENTERS_TAPPED = /\b(?:this [a-z]+|~|it) enters(?: the battlefield)? tapped\b/i;
/** Every way the card names itself: each face, and a legend's short name before the comma ("Boseiju enters tapped"). */
const selfNames = (cardName: string): string[] => cardName.split(" // ").flatMap((n) => [n, n.split(",")[0]!]).map((n) => n.toLowerCase());
const opensWithSelf = (text: string, cardName: string): boolean =>
  SELF_ENTERS_TAPPED.test(text) || selfNames(cardName).some((n) => text.toLowerCase().includes(`${n} enters`) && ENTERS_TAPPED.test(text));
const isSelfEntersTapped = (real: readonly { verb?: string; object?: string }[], text: string | undefined, cardName: string): boolean =>
  text !== undefined && opensWithSelf(text.trim(), cardName) && real.every((a) => a.verb === "tap" && (SELF_OBJECT.test((a.object ?? "").trim()) || selfNames(cardName).includes((a.object ?? "").trim().toLowerCase())))
  && ENTERS_TAPPED.test(text ?? "");

/** The dropped-action keys of one card, sorted. Empty when nothing is dropped. */
export function droppedKeys(records: readonly ClauseRecord[], homes: Homes): string[] {
  const out: string[] = [];
  for (const r of records) {
    if (homes.abilityClauses.has(r.id) || homes.granted.has(r.id)) continue;
    // Derive's own test (`INERT_VERBS.has(action.verb ?? "")`): an action with no verb is NOT inert.
    const real = (r.actions ?? []).filter((a) => !INERT_VERBS.has(a.verb ?? ""));
    if (real.length === 0) continue;
    // A SPLICED CLAUSE IS KEYED, NOT SKIPPED: `spliced` comes from the code under test, so skipping would let a bad splice excuse itself.
    if (homes.spliced.has(r.id)) { out.push(`${r.id}:spliced`); continue; }
    if ((homes.isLand || homes.hasManaLines) && isSelfEntersTapped(real, homes.texts[r.id as number], homes.cardName)) continue;
    if (homes.hasManaLines && real.some((a) => a.verb === "add-mana") && real.every((a) => MANA_VERBS.has(a.verb ?? ""))) continue;
    for (const a of real) out.push(`${r.id}:${a.verb ?? "?"}${zoneOf(a)}`);
  }
  return out.sort(cmp);
}

const zoneOf = (a: { fromZone?: string | null; toZone?: string | null }): string => (a.fromZone || a.toZone ? `:${a.fromZone ?? ""}>${a.toZone ?? ""}` : "");

/** One entry of `CardTags.unclaimed` (schema.ts `UnclaimedAction`), as far as this needs. */
export interface UnclaimedLike { clause: number | string; verb: string; object?: string; fromZone?: string; toZone?: string }

/** PARTIAL DROPS: an action derive REPORTED in `unclaimed` on a clause that DOES carry an ability. The clause-level test cannot see these:
 *  Condemn / Oust / Swords to Plowshares are one clause with [put|exile, gain-life], gain-life derives an ability carrying the clause id,
 *  so a tuck that derives nothing leaves the clause "claimed" (#1295). Key `<id>:<verb>[:<from>><to>]:partial`.
 *  Exclusions applied, the same rules as `droppedKeys` where they make sense: inert verbs (never listed by derive, kept for safety); granted
 *  clauses (derive skips them whole, so they never reach unclaimed; kept for safety); the self enters-tapped static on a land / mana-line card;
 *  the mana join (the clause contains add-mana and every real action is add-mana/tap/untap, on a mana-line card). Twins do not apply: a
 *  spliced clause has no ability, so it has no partial.
 *  CEILING: a partial drop that never reaches `unclaimed` (derive emits something WRONG instead of nothing) is invisible here. */
export function partialKeys(records: readonly ClauseRecord[], unclaimed: readonly UnclaimedLike[], homes: Homes): string[] {
  const out: string[] = [];
  for (const u of unclaimed) {
    if (!homes.abilityClauses.has(u.clause as number) || homes.granted.has(u.clause as number)) continue;
    if (INERT_VERBS.has(u.verb ?? "")) continue;
    if ((homes.isLand || homes.hasManaLines) && isSelfEntersTapped([u], homes.texts[u.clause as number], homes.cardName)) continue;
    const real = (records.find((r) => r.id === u.clause)?.actions ?? []).filter((a) => !INERT_VERBS.has(a.verb ?? ""));
    if (homes.hasManaLines && real.some((a) => a.verb === "add-mana") && real.every((a) => MANA_VERBS.has(a.verb ?? ""))) continue;
    out.push(`${u.clause}:${u.verb}${zoneOf(u)}:partial`);
  }
  return out.sort(cmp);
}

/** The three kinds of key in one card's list. */
export const keyKind = (key: string): "clause" | "partial" | "spliced" =>
  key.endsWith(":partial") ? "partial" : key.endsWith(":spliced") ? "spliced" : "clause";

/** The snapshot split by key kind (a card appears in a part only if it has a key of that kind). */
export function partitionKinds(m: Dropped): Record<"clause" | "partial" | "spliced", Dropped> {
  const out = { clause: {} as Dropped, partial: {} as Dropped, spliced: {} as Dropped };
  for (const [card, keys] of Object.entries(m)) for (const k of keys) (out[keyKind(k)][card] ??= []).push(k);
  return out;
}

export interface DropGroup { shape: string; actions: number; cards: number; examples: string[] }

/** `<id>:<verb>[:<from>><to>][:partial]` -> `<verb>[ <from>><to>][ partial]`; `<id>:spliced` -> `spliced`. */
const shapeOf = (key: string): string => {
  const rest = key.replace(/^[^:]+:/, "");
  const partial = rest.endsWith(":partial");
  const shape = (partial ? rest.slice(0, -":partial".length) : rest).replace(":", " ");
  return partial ? `${shape} partial` : shape;
};

/** The census table: one row per (verb, zone), biggest first, up to `examples` card names each. */
export function groupDropped(m: Dropped, examples = 3): DropGroup[] {
  const acc = new Map<string, { actions: number; cards: Set<string> }>();
  for (const card of Object.keys(m).sort(cmp)) {
    for (const k of m[card]!) {
      const s = shapeOf(k);
      let g = acc.get(s);
      if (!g) { g = { actions: 0, cards: new Set() }; acc.set(s, g); }
      g.actions++;
      g.cards.add(card);
    }
  }
  return [...acc].map(([shape, g]) => ({ shape, actions: g.actions, cards: g.cards.size, examples: [...g.cards].slice(0, examples) }))
    .sort((a, b) => b.actions - a.actions || cmp(a.shape, b.shape));
}

/** A dropped key's clause id (`<id>:<verb>...`). Ids may be strings ("2.1", a normalizer split), so it stays text. */
const clauseOf = (key: string): string => key.slice(0, key.indexOf(":"));

/** Split the drops by whether DERIVE REPORTED them: some entry of the card's `CardTags.unclaimed` names the clause
 *  (`reported`), or nothing says it was lost (`silent`). Summary only: the ratchet key is the same for both. */
export function splitReported(m: Dropped, reported: Readonly<Record<string, ReadonlySet<string>>>): { reported: Dropped; silent: Dropped } {
  const out = { reported: {} as Dropped, silent: {} as Dropped };
  for (const [card, keys] of Object.entries(m)) {
    for (const k of keys) {
      const side = reported[card]?.has(clauseOf(k)) ? out.reported : out.silent;
      (side[card] ??= []).push(k);
    }
  }
  return out;
}

export interface SplitGroup extends DropGroup { reported: number; silent: number }

/** `groupDropped` with the reported/silent split per shape. */
export function groupSplit(m: Dropped, reported: Readonly<Record<string, ReadonlySet<string>>>): SplitGroup[] {
  const parts = splitReported(m, reported);
  const count = (d: Dropped): Map<string, number> => new Map(groupDropped(d, 0).map((g) => [g.shape, g.actions]));
  const rep = count(parts.reported), sil = count(parts.silent);
  return groupDropped(m).map((g) => ({ ...g, reported: rep.get(g.shape) ?? 0, silent: sil.get(g.shape) ?? 0 }));
}
