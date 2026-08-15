/** CR 715.4 / 720.4: "In every zone except the stack, and while on the stack not as an Adventure
 *  [Omen], an adventurer [omen] card has only its NORMAL characteristics."
 *
 *  So Brazen Borrower in a graveyard is a Creature and NOT an Instant, and on the battlefield it is a
 *  Creature only. `splitTypeLine` unions every face, which is right for a transforming DFC — a
 *  transformed Westvale Abbey really IS a Demon — and wrong here, because an Adventure half is never
 *  a permanent and never a card in a zone. Same shape as the DFC fix at DERIVE_VERSION 30.
 *
 *  This asks whether the union actually COSTS anything: across the 71 decks, does an adventurer card
 *  satisfy a consumer that demands an instant or sorcery? Free, read-only. */
import { readFileSync, readdirSync } from "node:fs";
import { connect, loadConfig, mongoLookup, normalizeName, parseDecklistSections, resolveNames } from "@mtg/data";
import { ComboIndex } from "@mtg/engine";
import { createTagsLookup } from "@mtg/tagger";
import { analyzeDeckStructured, buildDeckCards, type CardTagsLookup } from "../index.js";

const DIR = "packages/cli/decks/calibration";
const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags: CardTagsLookup = createTagsLookup(store.db, "derived-first");

/** Cards whose SPELL half is an instant or sorcery — the ones the union can misrepresent. */
const adventurers = new Map((await store.cards
  .find({ layout: { $in: ["adventure", "prepare"] }, typeLine: /Instant|Sorcery/ } as never)
  .project({ name: 1, typeLine: 1 }).toArray() as unknown as { name: string; typeLine: string }[])
  .map((c) => [normalizeName(c.name), c.typeLine]));
console.log(`adventurer/omen cards with an instant-or-sorcery half: ${adventurers.size}\n`);

const hits = new Map<string, number>();
for (const file of readdirSync(DIR).filter((f) => f.endsWith(".txt")).sort()) {
  const sections = parseDecklistSections(readFileSync(`${DIR}/${file}`, "utf8"));
  const { cards, combos } = await resolveNames([...sections.commanders, ...sections.deck], lookup);
  const cmd = new Set(sections.commanders.map(normalizeName));
  const deckCards = await buildDeckCards(cards, lookup, tags);
  const report = analyzeDeckStructured(deckCards, cards.filter((c) => cmd.has(normalizeName(c.name))).map((c) => c.name),
    undefined, undefined, new ComboIndex(combos));
  for (const e of report.edges) {
    for (const r of e.reasons) {
      const producer = String((r as { producer?: string }).producer ?? "");
      if (!adventurers.has(normalizeName(producer))) continue;
      // Only the claims that turn on the SPELL half's type.
      const tag = String((r as { tag?: string }).tag ?? "");
      if (!/instant|sorcery/i.test(tag)) continue;
      const text = String((r as { text?: string }).text ?? "");
      hits.set(`${file.replace(/\.txt$/, "")} :: ${text}`, (hits.get(`${file} :: ${text}`) ?? 0) + 1);
    }
  }
}

console.log(`claims resting on an adventurer's SPELL-half type: ${hits.size}`);
for (const [k] of hits) console.log(`  ${k}`);
console.log(`\nNOTE: a claim about CASTING the Adventure is CORRECT — the spell really is an instant on`);
console.log(`the stack. Only claims about the card in a ZONE (a graveyard, the battlefield) are wrong.`);

await store.close();
process.exit(0);
