/** FREE. By-name role-membership ratchet (#1266). Fails in BOTH directions: a card that gains or
 *  loses a role or answer class turns this red, so a rules.json edit is measured card by card.
 *
 *  Reads the 71 calibration decks plus the precons in packages/data/precons.json, runs
 *  detectBuildCategories + detectAnswerClasses on their distinct cards, keys membership BY CARD (the detectors
 *  read the card and the rule set only, never the deck) and diffs against the tracked
 *  packages/instruments/role-membership.json.
 *
 *  Usage: npx tsx packages/instruments/src/role-ratchet.ts [--bank]
 *    (exit 1 on any change; `card  +key` is gained, `card  -key` is lost; --bank rewrites the snapshot) */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { CALIBRATION_DECKS, connect, loadConfig, mongoLookup, parseDecklistSections, resolveNames } from "@edh-seer/data";
import { createTagsLookup, DERIVE_VERSION } from "@edh-seer/tagger";
import { buildDeckCards, detectAnswerClasses, detectBuildCategories } from "@edh-seer/matcher";
import { diffMembership, listSome, mergeMembership, serialiseSnapshot, versionDrift, type Membership, type VersionGroup } from "./role-ratchet-core.js";

const SNAPSHOT = "packages/instruments/role-membership.json";
const { values } = parseArgs({ options: { bank: { type: "boolean", default: false } }, strict: true });
const bank = values.bank;


const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags = createTagsLookup(store.db, "derived");

// A snapshot is only comparable to a corpus derived at the version this code carries, in BOTH modes:
// banking over a stale derive would bless it, and checking against one reports the derive as a rules move.
const groups = await store.db.collection("cardTagsDerived")
  .aggregate<VersionGroup>([{ $group: { _id: "$deriveVersion", n: { $sum: 1 } } }]).toArray();
const drift = versionDrift(groups, DERIVE_VERSION);
if (drift.length > 0) {
  console.error(`cardTagsDerived is not at DERIVE_VERSION ${DERIVE_VERSION}: ${drift.map((g) => `v${g._id ?? "none"} x${g.n}`).join(", ")}. Re-run derive-corpus.`);
  await store.close();
  process.exit(1);
}

const decks: string[][] = [];
for (const file of readdirSync(CALIBRATION_DECKS).filter((f) => f.endsWith(".txt")).sort()) {
  const s = parseDecklistSections(readFileSync(`${CALIBRATION_DECKS}/${file}`, "utf8"));
  decks.push([...s.commanders, ...s.deck]);
}
const precons = JSON.parse(readFileSync("packages/data/precons.json", "utf8")) as
  { commanders: string[]; cards: { name: string }[] }[];
for (const p of precons) decks.push([...p.commanders, ...p.cards.map((c) => c.name)]);

// Detection is per card, so each distinct name is resolved and detected once (268 decks share most
// of their cards). Membership is a function of the card alone, so one pass IS the union over decks;
// mergeMembership is kept only to sort and de-duplicate the keys.
const unique = [...new Set(decks.flat())].sort();
const { cards, missing } = await resolveNames(unique, lookup);
const dc = await buildDeckCards(cards, lookup, tags);
const untagged = dc.filter((d) => d.tags === null).map((d) => d.card.name);
const m = new Map<string, string[]>();
const add = (n: string, k: string): void => { m.set(n, [...(m.get(n) ?? []), k]); };
for (const [cat, set] of detectBuildCategories(dc)) for (const n of set) add(n, `role:${cat}`);
for (const [cls, mem] of detectAnswerClasses(dc)) for (const n of mem.cards) add(n, `answer:${cls}`);
const perDeck = [m];
await store.close();

const measured = mergeMembership(perDeck);
const memberships = Object.values(measured).reduce((n, k) => n + k.length, 0);
const summary = `${Object.keys(measured).length} cards, ${memberships} memberships, ${decks.length} decks; ${missing.length} unresolved, ${untagged.length} untagged`;
// A card that does not resolve, or has no derived row, matches nothing: it would read as "no role" and bank
// as such. Unresolved is always an error. Untagged is ratcheted against a banked list, because two cards
// are underived today (no cardClauses row, not bought) and a permanently red instrument is read by no one.
const UNTAGGED = "packages/instruments/role-membership-untagged.json";
const untaggedSorted = [...new Set(untagged)].sort();
if (missing.length > 0) {
  console.error(`unresolved: ${listSome(missing)}\n${summary}`);
  process.exit(1);
}

if (bank) {
  writeFileSync(SNAPSHOT, serialiseSnapshot(measured));
  writeFileSync(UNTAGGED, `${JSON.stringify(untaggedSorted, null, 1)}\n`);
  console.log(`banked ${summary}`);
} else {
  const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Membership;
  const d = diffMembership(measured, snapshot);
  for (const [c, k] of d.gained) console.log(`${c}  +${k}`);
  for (const [c, k] of d.lost) console.log(`${c}  -${k}`);
  const bankedUntagged = JSON.parse(readFileSync(UNTAGGED, "utf8")) as string[];
  const untaggedMoved = untaggedSorted.filter((n) => !bankedUntagged.includes(n)).map((n) => `${n}  untagged (new)`)
    .concat(bankedUntagged.filter((n) => !untaggedSorted.includes(n)).map((n) => `${n}  tagged now (was untagged)`));
  for (const l of untaggedMoved) console.log(l);
  const changed = d.gained.length + d.lost.length + untaggedMoved.length;
  console.log(`${summary}; gained ${d.gained.length}, lost ${d.lost.length}, new cards ${d.newCards.length}, gone cards ${d.goneCards.length}`);
  if (changed > 0) {
    console.error("role membership moved. If intended, re-run with --bank and explain every line in the commit.");
    process.exit(1);
  }
}
