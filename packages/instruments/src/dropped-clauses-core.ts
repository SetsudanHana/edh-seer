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
 *      the best available one -- a clause whose every real action is `add-mana`, `tap` or `untap` (a mana
 *      ability or a mana-adjacent cost/tap line), on a card that derived at least one mana line. CEILING:
 *      card-level, not clause-level; a second, unrelated add-mana clause on the same card hides behind the
 *      first one's line. The same clause on a card with NO mana line is a drop, and is reported. */
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
}

/** The dropped-action keys of one card, sorted. Empty when nothing is dropped. */
export function droppedKeys(records: readonly ClauseRecord[], homes: Homes): string[] {
  const out: string[] = [];
  for (const r of records) {
    if (homes.abilityClauses.has(r.id) || homes.granted.has(r.id)) continue;
    const real = (r.actions ?? []).filter((a) => !INERT_VERBS.has(a.verb ?? "none"));
    if (real.length === 0) continue;
    if (homes.hasManaLines && real.every((a) => MANA_VERBS.has(a.verb ?? ""))) continue;
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
