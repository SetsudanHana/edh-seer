/** FREE. By-name role-membership ratchet (#1266). Fails in BOTH directions: a card that gains or
 *  loses a role or answer class turns this red, so a rules.json edit is measured card by card.
 *
 *  Reads the 71 calibration decks plus the precons in packages/data/precons.json, runs
 *  detectBuildCategories + detectAnswerClasses on each, unions membership BY CARD (the detectors
 *  read the card and the rule set only, never the deck) and diffs against the tracked
 *  packages/instruments/role-membership.json.
 *
 *  Usage: npx tsx packages/instruments/src/role-ratchet.ts [--bank]
 *    (exit 1 on any change; `card  +key` is gained, `card  -key` is lost; --bank rewrites the snapshot) */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { CALIBRATION_DECKS, connect, loadConfig, mongoLookup, parseDecklistSections, resolveNames } from "@edh-seer/data";
import { createTagsLookup } from "@edh-seer/tagger";
import { buildDeckCards, detectAnswerClasses, detectBuildCategories } from "@edh-seer/matcher";
import { diffMembership, mergeMembership, serialiseSnapshot, type Membership } from "./role-ratchet-core.js";

const SNAPSHOT = "packages/instruments/role-membership.json";
const bank = process.argv.includes("--bank");

const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags = createTagsLookup(store.db, "derived");

const decks: string[][] = [];
for (const file of readdirSync(CALIBRATION_DECKS).filter((f) => f.endsWith(".txt")).sort()) {
  const s = parseDecklistSections(readFileSync(`${CALIBRATION_DECKS}/${file}`, "utf8"));
  decks.push([...s.commanders, ...s.deck]);
}
const precons = JSON.parse(readFileSync("packages/data/precons.json", "utf8")) as
  { commanders: string[]; cards: { name: string }[] }[];
for (const p of precons) decks.push([...p.commanders, ...p.cards.map((c) => c.name)]);

// Detection is per card, so each distinct name is resolved and detected once (268 decks share most
// of their cards); the per-deck union the diff documents is the same set either way.
const unique = [...new Set(decks.flat())].sort();
const { cards } = await resolveNames(unique, lookup);
const dc = await buildDeckCards(cards, lookup, tags);
const m = new Map<string, string[]>();
const add = (n: string, k: string): void => { m.set(n, [...(m.get(n) ?? []), k]); };
for (const [cat, set] of detectBuildCategories(dc)) for (const n of set) add(n, `role:${cat}`);
for (const [cls, mem] of detectAnswerClasses(dc)) for (const n of mem.cards) add(n, `answer:${cls}`);
const perDeck = [m];
await store.close();

const measured = mergeMembership(perDeck);
const memberships = Object.values(measured).reduce((n, k) => n + k.length, 0);
const summary = `${Object.keys(measured).length} cards, ${memberships} memberships, ${decks.length} decks`;

if (bank) {
  writeFileSync(SNAPSHOT, serialiseSnapshot(measured));
  console.log(`banked ${summary}`);
} else {
  const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Membership;
  const d = diffMembership(measured, snapshot);
  for (const [c, k] of d.gained) console.log(`${c}  +${k}`);
  for (const [c, k] of d.lost) console.log(`${c}  -${k}`);
  const changed = d.gained.length + d.lost.length;
  console.log(`${summary}; gained ${d.gained.length}, lost ${d.lost.length}, new cards ${d.newCards.length}, gone cards ${d.goneCards.length}`);
  if (changed > 0) {
    console.error("role membership moved. If intended, re-run with --bank and explain every line in the commit.");
    process.exit(1);
  }
}
