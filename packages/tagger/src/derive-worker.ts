/** The per-card half of `bin/derive-corpus.ts`, run in a worker thread (see `@edh-seer/data/parallel`).
 *  Pure: no database. The main thread reads the clause doc and the card or token document, a worker
 *  derives, the main thread writes. Imported on the main thread for its types only. */
import { isMainThread } from "node:worker_threads";
import { serveWorker } from "@edh-seer/data/parallel";
import { charsFrom, deriveInputOf } from "./derive-input.js";
import { grammarClauseRecords } from "./grammar/clause-record.js";
import { deriveDiff, lostClaims, lostScaledAmount, lostSubjectFields, lostTriggerFlags, manaDiffers, refusedForAmount } from "./grammar/derive-diff.js";
import triage from "../grammar-only-triage.json" with { type: "json" };
import { BACK_REF_AMOUNT, QUANTIFIER_AMOUNT, deriveCardTags, foldGrantTwins } from "./derive/derive.js";
import { alignVerbs } from "./grammar/action.js";
import type { CardClausesDoc, DerivedTagsDoc } from "./clause-store.js";
import type { CardTags } from "./schema.js";
import type { ClauseRecord } from "./canonicalize.js";

export interface DeriveItem { doc: CardClausesDoc; source: Record<string, unknown>; isToken: boolean }
export interface DeriveResult { tags: CardTags; fromGrammar: boolean }

/** Drops exact-duplicate abilities (same JSON, clause included), keeping the first. */
function dedupe<T>(xs: T[]): T[] { const seen = new Set<string>(); return xs.filter((a) => { const k = JSON.stringify(a); return !seen.has(k) && !!seen.add(k); }); }

/** THE STORED AMOUNT A BACK-REFERENCE POINTS AT (#1403). The grammar reads "that many" / "that much"; the stored answer, where it resolves it ("the number of -1/-1 counters on it", Oft-Nabbed Goat),
 *  is the better amount, and derive keeps it over a back-referenced reading's (`BACK_REF_AMOUNT`). The grammar records carry the stored amount of the same clause and verb, so the grammar's reading
 *  derives it too, and the switch compares like with like: a card whose only difference was that amount stays on the grammar (Basri Ket's batched attack trigger, Cryptcaller Chariot's `batched`).
 *  Not a trigger's quantifier ("one or more", Cryptcaller's stored amount): that counts events, not the thing made.
 *  CEILING: aligned by verb within a clause of the same id; a clause the two segment differently carries nothing. */
export function carryStoredAmounts(grammar: ClauseRecord[], stored: ClauseRecord[]): ClauseRecord[] {
  return grammar.map((rec) => {
    const was = stored.find((c) => c.id === rec.id);
    if (!was?.actions?.length || !rec.actions?.length) return rec;
    const actions = rec.actions.map((a) => ({ ...a }));
    for (const [i, j] of alignVerbs(was.actions.map((a) => a.verb ?? ""), actions.map((a) => a.verb ?? ""))) {
      const old = was.actions[i]!.amount, now = actions[j]!.amount;
      if (typeof now === "string" && BACK_REF_AMOUNT.test(now) && typeof old === "string" && old !== "" && !BACK_REF_AMOUNT.test(old) && !QUANTIFIER_AMOUNT.test(old)) actions[j] = { ...actions[j]!, amount: old };
    }
    return { ...rec, actions };
  });
}

/** The keyword-grant twin fold (#1391; since F4 also an identical twin in an "instead" clause) applies to whichever tags win, never before the switch. */
const folded = (t: CardTags, texts?: Record<number, string>): CardTags => ({ ...t, abilities: foldGrantTwins(t.abilities, texts) });

/** The winner of the switch derived with the defaults (zone searches collapsed, grant twins folded). Only a card whose records hold a multi-search clause is derived again; the rest is the decision's tags, folded. */
function rederived(source: Record<string, unknown>, doc: CardClausesDoc, records: ClauseRecord[], readings: Parameters<typeof deriveInputOf>[5], decided: CardTags, isToken = false): CardTags {
  const searches = (records as ClauseRecord[]).some((c) => (c.actions ?? []).filter((a) => a.verb === "search").length > 1);
  const input = deriveInputOf(source as never, doc.oracleId, doc.name, records, isToken ? tokenCharsFrom(source as never) : undefined, readings);
  return searches ? deriveCardTags(input) : folded(decided, input.clauseTexts);
}

export function deriveRow({ doc, source, isToken }: DeriveItem): DeriveResult {
  // Always re-read printed characteristics from the card/token document. Reusing the existing
  // derived doc's copy would carry stale colours or a stale type line forward through every
  // re-derive, which is the opposite of what a free rebuild is for.
  const tags = deriveCardTags(deriveInputOf(source as never, doc.oracleId, doc.name, doc.canonical, isToken ? tokenCharsFrom(source as never) : undefined), { foldGrantTwins: false, collapseZoneSearches: false });
  // THE CARD-BY-CARD SWITCH (#896 task 7, owner 2026-10-02, option 1): a card the grammar reads
  // completely derives from its printed text alone -- no model answer in the loop -- when that gives
  // the same abilities as the stored answer, or a difference whose group is labelled "grammar right"
  // in grammar-only-triage.json. Every other card keeps its stored answer until its group is labelled.
  if (!isToken) {
    const g = grammarClauseRecords(source as never);
    if (g.complete) {
      const records = carryStoredAmounts(g.records, doc.canonical as ClauseRecord[]);
      const grammarTags = deriveCardTags(deriveInputOf(source as never, doc.oracleId, doc.name, records, undefined, g.readings), { foldGrantTwins: false, collapseZoneSearches: false });
      const key = deriveDiff(tags.abilities, grammarTags.abilities);
      // A labelled difference switches only when the grammar claims at least what the stored answer
      // claims (`lostClaims`): the label was judged on a few cards, the guard holds for every card.
      const right = key !== null && (triage.groups as Record<string, { label: string }>)[key]?.label === "grammar right"
        && lostClaims(tags.abilities, grammarTags.abilities).length === 0 && lostSubjectFields(tags.abilities, grammarTags.abilities).length === 0 && lostScaledAmount(tags.abilities, grammarTags.abilities).length === 0
        && !lostTriggerFlags(tags.abilities, grammarTags.abilities)
        // #1377: ...and does not drop a number the stored answer states, unless the stored answer is the worse reading in some other way (a `grants` or `toZone` only the grammar has; a stored emit subject field the grammar's emit lacks: Archghoul of Thraben's typed mill emit).
        && !refusedForAmount(tags.abilities, grammarTags.abilities);
      // MANA IS NOT IN `deriveDiff`: a card whose grammar reading derives other mana fields keeps the stored answer, identical abilities or not.
      // #1376: the stored answer IS the grammar's abilities with exact duplicates (`sameButDoubled`, the grammar having none): the grammar reading drops them.
      // Keyword-grant twins (one ability per granted keyword, each carrying the clause's whole list: Colossus of Akros' trample, Silverquill Pledgemage's cast/copy pair)
      // are folded (#1391) AFTER this switch, on the tags it picks: the switch compares UNFOLDED readings. Folding first changed the `abilities:N->M` diff keys, so labelled
      // "grammar right" count keys took new members judged on other cards (39 cards model->grammar, 4 grammar->model vs derive 401, wrong readings among them).
      // CEILING: the other two paths still take a grammar reading that carries other exact duplicates of its own (50 grammar cards at derive 402: Dragon Turtle's two
      // taps, search / token / draw shapes): refusing them on every path reverted 63 switches at derive 401, with real gains lost (Dragon Turtle's taps, Skrelv's toxic).
      const sameButDoubled = key !== null && dedupe(grammarTags.abilities).length === grammarTags.abilities.length && deriveDiff(dedupe(tags.abilities), grammarTags.abilities) === null;
      // The zone-search collapse (#1391 F3, one printed "search its graveyard, hand, and library" is one search ability) is likewise OFF for the decision: it changed the diff keys and flipped 5 cards
      // model->grammar, Finale of Devastation among them onto a reading whose enters emit claims the library only. The winner is RE-DERIVED with both dedupes on.
      if ((key === null || right || sameButDoubled) && !manaDiffers(tags, grammarTags)) return { tags: rederived(source, doc, records, g.readings, grammarTags), fromGrammar: true };
    }
  }
  return { tags: rederived(source, doc, doc.canonical as ClauseRecord[], undefined, tags, isToken), fromGrammar: false };
}

/** Same shape as `charsFrom`, plus `token: true` -- or, for a layout-`emblem` row, `emblem: true`
 *  and `token: false`. `extractCharacteristics` hardcodes `token: false` (right for every card,
 *  which is all it has ever seen) so this is the one place that flips it. Load-bearing in both
 *  directions per `subject.ts`'s asymmetric tri-state check: it is what lets a token satisfy a
 *  consumer demanding `token: true`, and what stops it satisfying one demanding `token: false`.
 *
 *  AN EMBLEM IS NOT A TOKEN (CR 114.1 vs 111.1): "whenever a token enters" must never match one,
 *  so `token` stays false and `emblem` says what it is. `splitTypeLine` already reads
 *  "Emblem — Chandra" as types `["emblem"]`, subtypes `["chandra"]`, which is what the node wants.
 *  A token document carries no `manaValue` -- `charsFrom` already defaults an absent one to 0. */
function tokenCharsFrom(doc: Parameters<typeof charsFrom>[0] & { layout?: string }): DerivedTagsDoc["characteristics"] {
  if (doc.layout === "emblem") return { ...charsFrom(doc), token: false, emblem: true };
  return { ...charsFrom(doc), token: true };
}

if (!isMainThread) serveWorker(deriveRow);
