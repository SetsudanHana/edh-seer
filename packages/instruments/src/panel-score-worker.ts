/** The per-deck half of `panel-score.ts`, run in a worker thread (see `@edh-seer/data/parallel`). It
 *  returns the deck's raw facts; the main thread replays them IN DECK ORDER, because the token
 *  re-attribution reads demands accumulated across earlier decks. */
import { existsSync, readFileSync } from "node:fs";
import { connect, loadConfig, mongoLookup, normalizeName, parseDecklistSections, resolveNames, CALIBRATION_DECKS } from "@edh-seer/data";
import { serveWorker } from "@edh-seer/data/parallel";
import { ComboIndex } from "@edh-seer/engine";
import { createTagsLookup } from "@edh-seer/tagger";
import { analyzeDeckStructured, buildDeckCards, loadTokenTags, type CardTagsLookup } from "@edh-seer/matcher";
import type { PanelClaim } from "./panel-core.js";

export type PanelDeck = { missing: true } | {
  missing: false;
  oracle: [string, string][];
  resolved: string[];
  /** In reason order: the deck's claims on the panel's pairs, and its token facts. */
  claims: PanelClaim[];
  madeBy: [string, string[]][];
  tokenClaims: string[];
  tokenDemands: string[];
};

const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags: CardTagsLookup = createTagsLookup(store.db, "derived");
// Task 6 (tokens-as-nodes). A `creates:` reason's consumer is the token's own name, which never
// appears in `pairs.json` (every panel pair names two real cards), so this cannot introduce judging
// debt on its own -- the `want` filter below drops it before it reaches the claims.
const tokenTags = await loadTokenTags(store.db);

serveWorker(async ({ deck, want }: { deck: string; want: string[] }): Promise<PanelDeck> => {
  const file = `${CALIBRATION_DECKS}/${deck}.txt`;
  if (!existsSync(file)) return { missing: true };
  const wanted = new Set(want);
  const sections = parseDecklistSections(readFileSync(file, "utf8"));
  const { cards, combos } = await resolveNames([...sections.commanders, ...sections.deck], lookup);
  const cmd = new Set(sections.commanders.map(normalizeName));
  const deckCards = await buildDeckCards(cards, lookup, tags);
  const report = analyzeDeckStructured(
    deckCards, cards.filter((c) => cmd.has(normalizeName(c.name))).map((c) => c.name),
    undefined, undefined, new ComboIndex(combos), undefined, tokenTags,
  );
  // EVERY reason, not just the panel's pairs: a claim the panel keys on two CARDS can now be
  // carried by a TOKEN one of them makes, and that hop is invisible if only wanted pairs are kept.
  const madeBy = new Map<string, Set<string>>();       // card -> tokens it creates
  const tokenClaims = new Set<string>();               // `${token}|${consumer}|${tag}`
  const tokenDemands = new Set<string>();              // `${producer}|${tokenConsumer}|${tag}`
  const claims: PanelClaim[] = [];
  for (const e of report.edges) {
    for (const r of e.reasons) {
      if (!r.producer || !r.consumer) continue;
      if (r.tag.startsWith("creates:")) {
        if (!madeBy.has(r.producer)) madeBy.set(r.producer, new Set());
        madeBy.get(r.producer)!.add(r.consumer);
      }
      if (r.producerIsToken) tokenClaims.add(`${r.producer}|${r.consumer}|${r.tag}`);
      if (r.consumerIsToken) tokenDemands.add(`${r.producer}|${r.consumer}|${r.tag}`);
      if (!wanted.has(`${r.producer}|${r.consumer}`)) continue;
      claims.push({ producer: r.producer, consumer: r.consumer, tag: r.tag, implied: r.impliedProducer === true });
    }
  }
  return {
    missing: false,
    oracle: cards.map((c) => [c.name, (c as { oracleText?: string }).oracleText ?? ""]),
    resolved: cards.map((c) => normalizeName(c.name)),
    claims,
    madeBy: [...madeBy].map(([card, toks]) => [card, [...toks]]),
    tokenClaims: [...tokenClaims],
    tokenDemands: [...tokenDemands],
  };
});
