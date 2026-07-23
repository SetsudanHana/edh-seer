import type { CardDoc } from "@mtg/data";
import { docToCard } from "@mtg/data";
import type { Card } from "@mtg/engine";
import type { CardTags } from "../schema.js";
import { SCHEMA_VERSION } from "../schema.js";
import { buildAbilityMessages, PROMPT_VERSION } from "../llm/prompt.js";
import { extractCharacteristics } from "../characteristics.js";
import { parseAbilities } from "../validate.js";

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
    abilities: parseAbilities(JSON.stringify({ abilities: rawAbilities })),
  };
}
