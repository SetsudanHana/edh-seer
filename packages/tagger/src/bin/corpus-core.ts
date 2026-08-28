import type { CardDoc } from "@edh-seer/data";
import { docToCard } from "@edh-seer/data";
import type { Card } from "@edh-seer/engine";
import type { CardTags } from "../schema.js";
import { SCHEMA_VERSION } from "../schema.js";
import { buildAbilityMessages, PROMPT_VERSION } from "../llm/prompt.js";
import { extractCharacteristics } from "../characteristics.js";
import { parseAbilities } from "../validate.js";
import { augmentKeywordAbilities } from "../keyword-augment.js";

/** Does this card's oracle text describe abilities the tagger is expected to record?
 *
 *  False only when the text is empty or consists entirely of printed keywords and their reminder
 *  text — a vanilla or near-vanilla card, for which `abilities: []` is the correct tagging.
 *
 *  This is the discriminator that was missing. `upsert-batch` already refused a non-array
 *  `abilities` as a model flake, but an empty ARRAY passed straight through and persisted as a
 *  vanilla card forever — and `selectUntagged` treats any card with a current-version tag doc as
 *  done, so those cards were never re-queued by the grind. That combination silently produced 1003
 *  cards with real rules text and zero recorded abilities, including Supreme Verdict, Hero's
 *  Downfall, Chaos Warp, Counterbalance and Bitterblossom — all invisible to the structured
 *  matcher, which reads abilities and nothing else. */
export function expectsAbilities(card: { oracleText?: string; keywords?: string[] }): boolean {
  const text = (card.oracleText ?? "").trim();
  if (text === "") return false;
  const keywords = (card.keywords ?? []).map((k) => k.toLowerCase());
  return text.split("\n").some((line) => {
    // Drop reminder text in parentheses, then treat "Flying, vigilance" as a keyword line only if
    // every comma-separated part is a printed keyword of this card. Keywords take arguments —
    // "protection from Demons", "ward {2}", "hexproof from black", "landwalk" variants — so match
    // on the part STARTING WITH a keyword, not equalling it. Requiring equality mis-read
    // french-vanilla cards like Baneslayer Angel as holes, and this predicate gates upsert-batch:
    // over-firing there rejects a legitimately empty tagging instead of persisting it.
    const bare = line.replace(/\s*\([^()]*\)\s*/g, "").trim().toLowerCase();
    if (bare === "") return false;
    return !bare
      .split(/,\s*/)
      .every((part) => keywords.some((k) => part.trim() === k || part.trim().startsWith(`${k} `)));
  });
}

/** Untagged (id not in doneIds), non-empty-text cards, most-played first (edhrecRank asc,
 *  undefined last, tiebreak _id), capped at n. */
export function selectUntagged(cards: CardDoc[], doneIds: Set<string>, n: number): CardDoc[] {
  const rank = (c: CardDoc): number => (c.edhrecRank ?? Number.POSITIVE_INFINITY);
  return cards
    .filter((c) => c.oracleText.trim() !== "" && !doneIds.has(c._id))
    .sort((x, y) => rank(x) - rank(y) || x._id.localeCompare(y._id))
    .slice(0, n);
}

/** The shared tagging preamble: the system prompt + few-shot examples that buildAbilityMessages
 *  prepends before a card's own user turn. We drop that final turn so the block is card-agnostic
 *  and a subagent can apply it to a whole batch. */
export function renderPreamble(card: CardDoc): string {
  const messages = buildAbilityMessages(docToCard(card));
  return messages
    .slice(0, -1) // drop the final per-card user turn
    .map((m) => `[${m.role.toUpperCase()}]\n${m.content}`)
    .join("\n\n");
}

/** Build a CardTags from a subagent's raw abilities array (no LLM). Mirrors extractCardTags but
 *  takes pre-computed abilities: normalize through the lenient validator, attach deterministic
 *  characteristics, stamp current versions. */
export function cardTagsFromRawAbilities(
  oracleId: string,
  card: Card,
  rawAbilities: unknown[],
  model: string,
): CardTags {
  return {
    oracleId,
    schemaVersion: SCHEMA_VERSION,
    promptVersion: PROMPT_VERSION,
    model,
    characteristics: extractCharacteristics(card),
    abilities: augmentKeywordAbilities(card.oracleText, parseAbilities(JSON.stringify({ abilities: rawAbilities }))),
  };
}

/** Dispatched oracleIds that produced no result (batch-boundary drops). Deduped, order-preserving. */
export function missingOracleIds(dispatched: string[], resulted: string[]): string[] {
  const have = new Set(resulted);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of dispatched) {
    if (!have.has(id) && !seen.has(id)) { seen.add(id); out.push(id); }
  }
  return out;
}

/** Up to k distinct items via partial Fisher–Yates on a copy, using the injected RNG. */
export function sample<T>(items: T[], k: number, rand: () => number): T[] {
  const a = [...items];
  const n = Math.min(k, a.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rand() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

/** Corpus coverage snapshot for a fresh session to orient from. */
export function coverageReport(
  cards: CardDoc[],
  doneIds: Set<string>,
  cutoff: number,
): { total: number; tagged: number; remainingUnderCutoff: number; nextRank: number | null } {
  const textCards = cards.filter((c) => c.oracleText.trim() !== "");
  const untagged = textCards.filter((c) => !doneIds.has(c._id));
  const ranks = untagged.map((c) => c.edhrecRank).filter((r): r is number => r !== undefined);
  return {
    total: textCards.length,
    tagged: textCards.filter((c) => doneIds.has(c._id)).length,
    remainingUnderCutoff: untagged.filter((c) => c.edhrecRank !== undefined && c.edhrecRank <= cutoff).length,
    nextRank: ranks.length ? Math.min(...ranks) : null,
  };
}
