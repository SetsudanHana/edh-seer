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
 *      (`twinOf` / `redundant` in derive.ts) and the ability carries the partner's id. The twin map comes from
 *      derive's own run (`deriveAbilitiesOf`), never a re-implementation; a clause is excluded when its twin's
 *      partner has an ability.
 *   4. A SELF "ENTERS TAPPED" STATIC (Rootbound Crag, Marble Diamond): every real action is `tap` on a self object
 *      ("this land", "this artifact", "this", the card's own name) AND the clause's printed text says "enters tapped".
 *      Derive has no field for it (it reports `unclaimed {tap}`); its home is the matcher's printed-text readers,
 *      `mana-base.ts` (TAPPED: a land that always enters tapped) and `land-score.ts` (enters-tapped patterns). CEILING:
 *      the home is a printed-text reader, so this exclusion reads the text too; "tap target creature" and a cost-like
 *      "tap an untapped creature you control" are kept because their object is not self and the text does not say it.
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
  /** `deriveAbilitiesOf(...).twinOf`: a re-homed record -> the record that already read its event off the same sentence. */
  twinOf: ReadonlyMap<number | string, number | string>;
  /** Clause id -> printed clause text (`clauseTexts(card)`). */
  texts: Readonly<Record<number, string>>;
  /** The card's own name, for a self object. */
  cardName: string;
}

const ENTERS_TAPPED = /\benters(?: the battlefield)? tapped\b/i;
const SELF_OBJECT = /^(?:this(?: [a-z]+)?|~|it)$/i;
const isSelfEntersTapped = (real: readonly { verb?: string; object?: string }[], text: string | undefined, cardName: string): boolean =>
  real.every((a) => a.verb === "tap" && (SELF_OBJECT.test((a.object ?? "").trim()) || (a.object ?? "").trim().toLowerCase() === cardName.toLowerCase()))
  && ENTERS_TAPPED.test(text ?? "");

/** The dropped-action keys of one card, sorted. Empty when nothing is dropped. */
export function droppedKeys(records: readonly ClauseRecord[], homes: Homes): string[] {
  const out: string[] = [];
  for (const r of records) {
    if (homes.abilityClauses.has(r.id) || homes.granted.has(r.id)) continue;
    // Derive's own test (`INERT_VERBS.has(action.verb ?? "")`): an action with no verb is NOT inert.
    const real = (r.actions ?? []).filter((a) => !INERT_VERBS.has(a.verb ?? ""));
    if (real.length === 0) continue;
    const partner = homes.twinOf.get(r.id);
    if (partner !== undefined && homes.abilityClauses.has(partner as number)) continue;
    if (isSelfEntersTapped(real, homes.texts[r.id as number], homes.cardName)) continue;
    if (homes.hasManaLines && real.some((a) => a.verb === "add-mana") && real.every((a) => MANA_VERBS.has(a.verb ?? ""))) continue;
    for (const a of real) {
      const zone = a.fromZone || a.toZone ? `:${a.fromZone ?? ""}>${a.toZone ?? ""}` : "";
      out.push(`${r.id}:${a.verb ?? "?"}${zone}`);
    }
  }
  return out.sort(cmp);
}

export interface DropGroup { shape: string; actions: number; cards: number; examples: string[] }

/** `<id>:<verb>[:<from>><to>]` -> `<verb>[ <from>><to>]`. */
const shapeOf = (key: string): string => key.replace(/^\d+:/, "").replace(":", " ");

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
