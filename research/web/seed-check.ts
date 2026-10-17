/** THE POD-FIT SEAT'S INJECTED PLANT STILL WORKS, or this exits 1 (issues #515, #1251).
 *
 *  The seat is self-calibrating: its deck carries a claim the owner hand-judged FALSE, so a run where
 *  it questions nothing is a run where the instrument has gone soft. The plant used to be a LIVE ENGINE
 *  BUG and rotted three times; since 2026-10-17 the harness injects it (`plant.ts`), and the engine
 *  must NOT make it on its own (owner 2026-10-16: no live FALSE claims while the panel targets 100%).
 *  Two analyses of the deck, both from Mongo:
 *
 *    (a) UNPATCHED must NOT emit the plant sentence -- if it does the engine has a live owner-FALSE
 *        claim: fix the engine, the plant must be injected only.
 *    (b) PATCHED (`plantTags` applied to Lively Dirge) MUST emit it. The plant now rots only on a
 *        derive change to Lively Dirge, and this is the check that says so (PLANT ROTTED).
 *
 *  Run before every persona round:
 *
 *    npx tsx research/web/seed-check.ts
 *
 *  Needs Mongo, like every analysis bin: `set -a && source packages/tagger/.env && set +a`. */
import { readFileSync } from "node:fs";
import { connect, loadConfig, mongoLookup, normalizeName, parseDecklistSections, resolveNames } from "../../packages/data/src/index.js";
import { createTagsLookup } from "../../packages/tagger/src/index.js";
import { ComboIndex } from "../../packages/engine/src/index.js";
import { analyzeDeckStructured, buildDeckCards, loadTokenTags } from "../../packages/matcher/src/index.js";
import { PLANT, plantTags } from "./plant.js";

const store = await connect(loadConfig());
try {
  const sections = parseDecklistSections(readFileSync(PLANT.deck, "utf8"));
  const lookup = mongoLookup(store);
  const { cards, combos } = await resolveNames([...sections.commanders, ...sections.deck], lookup);
  const cmd = new Set(sections.commanders.map(normalizeName));
  const commanders = cards.filter((c) => cmd.has(normalizeName(c.name))).map((c) => c.name);
  const tokens = await loadTokenTags(store.db);
  const base = await buildDeckCards(cards, lookup, createTagsLookup(store.db, "derived"));
  const analyse = (deck: typeof base) => analyzeDeckStructured(deck, commanders, undefined, undefined, new ComboIndex(combos), undefined, tokens)
    .edges.flatMap((e) => e.reasons)
    .filter((r) => r.producer === PLANT.card && r.consumer === PLANT.consumer && PLANT.tag.test(r.tag) && r.text === PLANT.sentence);

  const live = analyse(base);
  if (live.length > 0) {
    console.error(`LIVE FALSE CLAIM — fix the engine, the plant must be injected only: "${live[0].text}" (${live[0].tag}) is emitted unpatched in ${PLANT.deck} (${PLANT.verdict}).`);
    process.exitCode = 1;
  } else {
    let patched: typeof base | undefined;
    try {
      if (!base.some((d) => d.card.name === PLANT.card)) throw new Error(`PLANT ROTTED: ${PLANT.card} is not in ${PLANT.deck}`);
      patched = base.map((d) => d.card.name === PLANT.card ? { ...d, tags: plantTags(d.tags) } : d);
    } catch (e) {
      console.error((e as Error).message);
      process.exitCode = 1;
    }
    if (patched) {
      const hit = analyse(patched)[0];
      if (hit) console.log(`plant ok: "${hit.text}" (injected)`);
      else {
        console.error(`PLANT ROTTED: injecting the sibling emit into ${PLANT.card} no longer yields "${PLANT.sentence}" (${PLANT.tag}) ${PLANT.card} -> ${PLANT.consumer} in ${PLANT.deck}.`);
        console.error("The pod-fit seat calibrates nothing until a new plant is chosen. Do not run the round.");
        process.exitCode = 1;
      }
    }
  }
} finally {
  await store.close();
}
