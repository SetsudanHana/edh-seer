/** FREE. By-name role-membership ratchet (#1266). Fails in BOTH directions: a card that gains or
 *  loses a role or answer class turns this red, so a rules.json edit is measured card by card.
 *
 *  Runs detectBuildCategories + detectAnswerClasses + detectWincons over EVERY commander-legal card in the corpus (the detectors
 *  read the card and the rule set only, never the deck, so the card is the unit), keys membership BY CARD and
 *  diffs against the tracked packages/instruments/role-membership.json. A card with no role has no line.
 *
 *  Usage: npx tsx packages/instruments/src/role-ratchet.ts [--bank]
 *    (exit 1 on any change; `card  +key` is gained, `card  -key` is lost; --bank rewrites the snapshot) */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { connect, docToCard, isStickerCard, loadConfig, type CardDoc } from "@edh-seer/data";
import { createTagsLookup, DERIVE_VERSION } from "@edh-seer/tagger";
import { detectAnswerClasses, detectBuildCategories, detectWincons, type DeckCard } from "@edh-seer/matcher";
import { measureRoles, type RoleDetectors } from "./ratchet-measure.js";
import { diffMembership, serialiseSnapshot, versionDrift, type Membership, type VersionGroup } from "./role-ratchet-core.js";

const SNAPSHOT = "packages/instruments/role-membership.json";
const { values } = parseArgs({ options: { bank: { type: "boolean", default: false } }, strict: true });
const bank = values.bank;


const store = await connect(loadConfig());
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

// EVERY commander-legal card in the corpus, not the decks we happen to hold: the detectors are per card and a
// user can paste any of them (#1266 review: the 268 decks held 13% of the derived rows). Sticker cards are
// outside the engine (`isStickerCard`), as in `resolveNames`.
const docs = await store.db.collection<CardDoc>("cards").find({ "legalities.commander": "legal" }).sort({ name: 1 }).toArray();
const inEngine = docs.filter((d) => !isStickerCard(d));
const dc: DeckCard[] = new Array(inEngine.length);
for (let i = 0; i < inEngine.length; i += 200) {
  await Promise.all(inEngine.slice(i, i + 200).map(async (d, j) => {
    dc[i + j] = { card: docToCard(d), tags: await tags.findOne(d._id) };
  }));
}
const untagged = dc.filter((d) => d.tags === null).map((d) => d.card.name);
await store.close();

const measured = measureRoles(dc, { detectBuildCategories, detectAnswerClasses, detectWincons } as unknown as RoleDetectors);
const memberships = Object.values(measured).reduce((n, k) => n + k.length, 0);
const summary = `${Object.keys(measured).length} cards, ${memberships} memberships, of ${dc.length} commander-legal cards (${docs.length - inEngine.length} stickers skipped); ${untagged.length} untagged`;
// A card with no derived row matches nothing: it would read as "no role" and bank as such. Untagged is ratcheted
// against a banked list, because a card is underived today (no cardClauses row, not bought) and a permanently
// red instrument is read by no one. `listSome` names them when the list moves.
const UNTAGGED = "packages/instruments/role-membership-untagged.json";
const untaggedSorted = [...new Set(untagged)].sort();

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
