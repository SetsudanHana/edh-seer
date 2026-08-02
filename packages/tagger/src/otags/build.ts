/** Invert tag->oracleIds into oracleId->sorted-unique-otags, keeping only corpus oracleIds. */
export function buildCardOtags(tagToIds: Map<string, string[]>, corpusIds: Set<string>): Map<string, string[]> {
  const out = new Map<string, Set<string>>();
  for (const [slug, ids] of tagToIds) {
    for (const id of ids) {
      if (!corpusIds.has(id)) continue;
      let s = out.get(id);
      if (!s) { s = new Set(); out.set(id, s); }
      s.add(slug);
    }
  }
  return new Map([...out].map(([id, s]) => [id, [...s].sort()]));
}
