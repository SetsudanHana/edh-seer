// The builder's question as a typed query (#1783), so the text box can show what the rows ask.
import type { EventQuery } from "../facets.js";
import { termsOf, type EventTerm } from "../event-terms.js";
import { fromEventQuery, type PageMode } from "./from-event-query.js";
import { fromNode, type Query } from "./query.js";

/** What the rows ask, as a query; null when it asks nothing, or holds something with no words (a NOT naming a word the
 *  vocabulary lacks). The ability type, how-often and amount rows have no typed form and are not in it. */
export function builderQuery(q: EventQuery, mode: PageMode, abilityFields?: ReadonlySet<string>): Query | null {
  const leaf = (t: EventTerm): Query => ({ op: "event", side: t.side === "makes" ? "makes" : "asks", key: t.key });
  const terms = termsOf(q);
  const parts: Query[] = terms.filter((t) => t.op === "and").map(leaf);
  const any = terms.filter((t) => t.op === "or").map(leaf);
  if (any.length === 1) parts.push(any[0]!);
  else if (any.length > 1) parts.push({ or: any });
  for (const t of terms) if (t.op === "not") parts.push({ not: leaf(t) });
  const chars = fromNode(fromEventQuery(q, mode, abilityFields ? { abilityFields } : {}));
  if (chars === null) return null;
  if ("and" in chars) parts.push(...chars.and); else parts.push(chars);
  return parts.length === 0 ? null : parts.length === 1 ? parts[0]! : { and: parts };
}
