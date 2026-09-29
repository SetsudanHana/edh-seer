/** THE POD-FIT SEAT'S PLANTED FALSE CLAIM IS STILL THERE, or this exits 1 (issue #515).
 *
 *  The seat is self-calibrating: its deck carries a claim the owner hand-judged FALSE, so a run where
 *  it questions nothing is a run where the instrument has gone soft. That only works while the engine
 *  still MAKES the claim -- and twice now it silently stopped (2026-09-18, and Misty Rainforest ->
 *  Yuna between 2026-09-20 and 2026-09-26), leaving a seat that calibrated nothing. Run this before
 *  every persona round; when it fails, pick a new plant from the owner's live FALSE verdicts
 *  (.claude/agents/README.md, "How that fixture was chosen").
 *
 *    npx tsx research/web/seed-check.ts
 *
 *  Needs Mongo, like every analysis bin: `set -a && source packages/tagger/.env && set +a`. */
import { readFileSync } from "node:fs";
import { connect, loadConfig, mongoLookup, normalizeName, parseDecklistSections, resolveNames } from "../../packages/data/src/index.js";
import { createTagsLookup } from "../../packages/tagger/src/index.js";
import { ComboIndex } from "../../packages/engine/src/index.js";
import { analyzeDeckStructured, buildDeckCards, loadTokenTags } from "../../packages/matcher/src/index.js";

/** Keep in step with the README's "The pod-fit seat's seeded claim". A FAMILY, not one link: the
 *  owner's verdict (Lively Dirge, 2026-09-26) is a subject mismatch any graveyard filler repeats
 *  against Tinybones, and by 2026-09-29 Lively Dirge's own link was gone while four others were
 *  live. The check passes while any of them is emitted. */
const SEED = {
  deck: "packages/cli/decks/calibration/mari-takes-control.txt",
  producers: ["Lively Dirge", "Meathook Massacre II", "Trading Post", "Spymaster's Vault", "The Sackville-Bagginses"],
  consumer: "Tinybones, the Pickpocket",
  tag: /^graveyard-recursion/,
};

const store = await connect(loadConfig());
try {
  const sections = parseDecklistSections(readFileSync(SEED.deck, "utf8"));
  const lookup = mongoLookup(store);
  const { cards, combos } = await resolveNames([...sections.commanders, ...sections.deck], lookup);
  const cmd = new Set(sections.commanders.map(normalizeName));
  const report = analyzeDeckStructured(
    await buildDeckCards(cards, lookup, createTagsLookup(store.db, "derived")),
    cards.filter((c) => cmd.has(normalizeName(c.name))).map((c) => c.name),
    undefined, undefined, new ComboIndex(combos), undefined, await loadTokenTags(store.db),
  );
  const hit = report.edges.flatMap((e) => e.reasons)
    .find((r) => r.producer !== undefined && SEED.producers.includes(r.producer) && r.consumer === SEED.consumer && SEED.tag.test(r.tag));
  if (!hit) {
    console.error(`SEED GONE: no ${SEED.producers.join(" / ")} -> ${SEED.consumer} | ${SEED.tag} in ${SEED.deck}.`);
    console.error("The pod-fit seat calibrates nothing until a new plant is chosen. Do not run the round.");
    process.exitCode = 1;
  } else {
    console.log(`seed ok: "${hit.text}" (${hit.tag}) in ${SEED.deck}`);
  }
} finally {
  await store.close();
}
