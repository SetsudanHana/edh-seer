/** The per-card half of `bin/derive-corpus.ts`, run in a worker thread (see `@edh-seer/data/parallel`).
 *  Pure: no database. The main thread reads the clause doc and the card or token document, a worker
 *  derives, the main thread writes. Imported on the main thread for its types only. */
import { isMainThread } from "node:worker_threads";
import { serveWorker } from "@edh-seer/data/parallel";
import { charsFrom, deriveInputOf } from "./derive-input.js";
import { grammarClauseRecords } from "./grammar/clause-record.js";
import { deriveDiff, lostClaims } from "./grammar/derive-diff.js";
import triage from "../grammar-only-triage.json" with { type: "json" };
import { deriveCardTags } from "./derive/derive.js";
import type { CardClausesDoc, DerivedTagsDoc } from "./clause-store.js";
import type { CardTags } from "./schema.js";

export interface DeriveItem { doc: CardClausesDoc; source: Record<string, unknown>; isToken: boolean }
export interface DeriveResult { tags: CardTags; fromGrammar: boolean }

export function deriveRow({ doc, source, isToken }: DeriveItem): DeriveResult {
  // Always re-read printed characteristics from the card/token document. Reusing the existing
  // derived doc's copy would carry stale colours or a stale type line forward through every
  // re-derive, which is the opposite of what a free rebuild is for.
  const tags = deriveCardTags(deriveInputOf(source as never, doc.oracleId, doc.name, doc.canonical, isToken ? tokenCharsFrom(source as never) : undefined));
  // THE CARD-BY-CARD SWITCH (#896 task 7, owner 2026-10-02, option 1): a card the grammar reads
  // completely derives from its printed text alone -- no model answer in the loop -- when that gives
  // the same abilities as the stored answer, or a difference whose group is labelled "grammar right"
  // in grammar-only-triage.json. Every other card keeps its stored answer until its group is labelled.
  if (!isToken) {
    const g = grammarClauseRecords(source as never);
    if (g.complete) {
      const grammarTags = deriveCardTags(deriveInputOf(source as never, doc.oracleId, doc.name, g.records));
      const key = deriveDiff(tags.abilities, grammarTags.abilities);
      // A labelled difference switches only when the grammar claims at least what the stored answer
      // claims (`lostClaims`): the label was judged on a few cards, the guard holds for every card.
      const right = key !== null && (triage.groups as Record<string, { label: string }>)[key]?.label === "grammar right"
        && lostClaims(tags.abilities, grammarTags.abilities).length === 0;
      if (key === null || right) return { tags: grammarTags, fromGrammar: true };
    }
  }
  return { tags, fromGrammar: false };
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
