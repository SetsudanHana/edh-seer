/** Lines `isKeywordLine` makes INERT that are really full sentences.
 *
 *  A keyword line is "Flying", "Ward {2}", "Flying, trample" — a bare printed keyword, correctly
 *  inert. `isKeywordLine` accepts any line whose parts each EQUAL a printed keyword or START with
 *  one, and Scryfall's `keywords` includes keyword ACTIONS and ability words, not just abilities.
 *  So Dark Dabbling — keywords ["Heal","Regenerate","Spell mastery"] — has "Regenerate target
 *  creature. Draw a card." swallowed whole, and the card's entire effect never reaches derivation.
 *
 *  Found because the persist gate REFUSED that card and the refusal was worth reading rather than
 *  retrying. Free, read-only. */
import { connect, loadConfig } from "@edh-seer/data";

const store = await connect(loadConfig());

/** A copy of segment.ts's predicate, so this measures the SHIPPED behaviour rather than a guess. */
function isKeywordLine(line: string, keywords: string[]): boolean {
  if (line === "") return false;
  const kw = keywords.map((k) => k.toLowerCase());
  return line.toLowerCase().split(/,\s*/)
    .every((part) => kw.some((k) => part.trim() === k || part.trim().startsWith(`${k} `)));
}

/** Does this line state an ACTION rather than name a keyword? A real keyword line is a name and at
 *  most a parameter ("Ward {2}", "Annihilator 2", "Protection from Demons"). A sentence has a verb
 *  and usually a period. */
const looksLikeSentence = (line: string): boolean =>
  /\.\s/.test(line) || /\b(target|each|all|you|your|its|their|the top|up to)\b/i.test(line);

const cards = await store.cards.find({ keywords: { $exists: true, $ne: [] } } as never)
  .project({ name: 1, oracleText: 1, keywords: 1 }).toArray() as unknown as
  { name: string; oracleText?: string; keywords?: string[] }[];

const hits: { name: string; line: string; kw: string[] }[] = [];
for (const c of cards) {
  for (const raw of (c.oracleText ?? "").split("\n")) {
    const line = raw.replace(/\s*\([^()]*\)\s*$/, "").trim();
    if (!isKeywordLine(line, c.keywords ?? [])) continue;
    if (!looksLikeSentence(line)) continue;
    hits.push({ name: c.name, line: line.slice(0, 110), kw: c.keywords ?? [] });
  }
}

console.log(`cards with printed keywords: ${cards.length}`);
console.log(`SENTENCES made inert by isKeywordLine: ${hits.length} over ${new Set(hits.map((h) => h.name)).size} cards\n`);
const byKw = new Map<string, number>();
for (const h of hits) {
  const first = h.line.toLowerCase().split(/[ ,]/)[0];
  byKw.set(first, (byKw.get(first) ?? 0) + 1);
}
console.log(`leading keyword:`);
for (const [k, n] of [...byKw].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
console.log(`\nwitnesses:`);
for (const h of hits.slice(0, 20)) console.log(`  ${h.name}: ${h.line}`);

await store.close();
process.exit(0);
