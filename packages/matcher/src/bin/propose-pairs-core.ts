import { normalizeName } from "@edh-seer/data";
import type { MechanismCategory } from "../mechanisms.js";
import type { GoldPair } from "./eval-pairs-core.js";

/** A raw LLM-proposed pair before name resolution / dedup. */
export interface RawPair {
  a: string;
  b: string;
  note: string;
}

/** Parse the LLM completion into pairs. Accepts a bare JSON array of {a,b,note} OR the object form
 *  `{"pairs":[...]}` (the Anthropic provider prefills "{" so it returns an object). Throws on
 *  malformed input. */
export function parseProposals(raw: string): RawPair[] {
  const parsed = JSON.parse(raw);
  const arr = Array.isArray(parsed) ? parsed : (parsed as { pairs?: unknown })?.pairs;
  if (!Array.isArray(arr)) throw new Error("proposals must be a JSON array or {pairs:[...]}");
  return arr.map((p): RawPair => {
    if (!p || typeof p.a !== "string" || typeof p.b !== "string") {
      throw new Error(`malformed proposal: ${JSON.stringify(p)}`);
    }
    return { a: p.a, b: p.b, note: typeof p.note === "string" ? p.note : "" };
  });
}

/** Order-insensitive, normalized key for a pair (so A–B and B–A collide). */
export function pairKey(a: string, b: string): string {
  return [normalizeName(a), normalizeName(b)].sort().join("|");
}

export interface BuildResult {
  accepted: GoldPair[];
  unresolved: RawPair[];
  duplicates: RawPair[];
}

/** Resolve both card names, drop unresolved and existing duplicates, and stamp survivors as
 *  unverified gold entries in the given category. `resolve` returns the canonical card name or null. */
export function dedupeAndBuild(
  raw: RawPair[],
  category: MechanismCategory,
  existing: GoldPair[],
  resolve: (name: string) => string | null,
): BuildResult {
  const seen = new Set(existing.map((e) => pairKey(e.a, e.b)));
  const accepted: GoldPair[] = [];
  const unresolved: RawPair[] = [];
  const duplicates: RawPair[] = [];
  for (const p of raw) {
    const a = resolve(p.a);
    const b = resolve(p.b);
    if (!a || !b) {
      unresolved.push(p);
      continue;
    }
    const key = pairKey(a, b);
    if (seen.has(key)) {
      duplicates.push(p);
      continue;
    }
    seen.add(key);
    accepted.push({ a, b, category, note: p.note, source: "llm-proposed", verified: false });
  }
  return { accepted, unresolved, duplicates };
}
