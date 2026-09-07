/** FREE. Re-scores the frozen panel against the CURRENT engine. Run after every change.
 *
 *  Spec: `docs/superpowers/specs/2026-08-05-edge-precision-measurement-design.md` §23-24.
 *
 *  This is the paired replacement for fresh sampling. The pairs never change, so a difference between
 *  two runs is the ENGINE, not a new draw of the dice — which is what three consecutive "no
 *  measurable change" verdicts and one 6-point move on an untouched population were really saying.
 *
 *  Prints precision on the panel, and the JUDGING DEBT: claims the engine makes today that no verdict
 *  covers. The debt is the honest part. A change that adds claims cannot flatter itself, because its
 *  new claims count as owed rather than as real, and the precision figure is explicitly conditional
 *  on the debt being small.
 *
 *  Usage: tsx src/bin/panel-score.ts [--worksheet out.jsonl] */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  connect, loadConfig, mongoLookup, normalizeName, parseDecklistSections, resolveNames,
} from "@edh-seer/data";
import { ComboIndex } from "@edh-seer/engine";
import { createTagsLookup } from "@edh-seer/tagger";
import { analyzeDeckStructured, buildDeckCards, loadTokenTags, type CardTagsLookup } from "@edh-seer/matcher";
import { claimFor } from "./precision-core.js";
import { ratchetLostPairs, scorePanel, wilsonPanel, type PanelClaim, type PanelVerdict } from "./panel-core.js";

const PANEL = "docs/measurements/panel";
const DECKS = "packages/cli/decks/calibration";
const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const pairs = (JSON.parse(readFileSync(`${PANEL}/pairs.json`, "utf8")) as {
  pairs: { producer: string; consumer: string; deck: string }[];
}).pairs;
const cache = readFileSync(`${PANEL}/verdicts.jsonl`, "utf8").split("\n")
  .filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as PanelVerdict);

const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags: CardTagsLookup = createTagsLookup(store.db, "derived");
// Task 6 (tokens-as-nodes). A `creates:` reason's consumer is the token's own name, which never
// appears in `pairs.json` (every panel pair names two real cards), so this cannot introduce judging
// debt on its own -- the `want.has(...)` filter below drops it before it reaches `current`.
const tokenTags = await loadTokenTags(store.db);

// Scored DECK BY DECK through `analyzeDeckStructured`, the same entry point the sampling instrument
// used and the same one the product uses. Calling `pairReasons` directly skips the deck-level passes
// -- chosenType resolution above all, which picks the deck's dominant subtype -- and a panel that
// skips them measures something adjacent to the engine rather than the engine. Found the hard way:
// the chosenType fix moved nothing until this was corrected.
const wantedByDeck = new Map<string, Set<string>>();
for (const p of pairs) {
  if (!wantedByDeck.has(p.deck)) wantedByDeck.set(p.deck, new Set());
  wantedByDeck.get(p.deck)!.add(`${p.producer}|${p.consumer}`);
}

const current: PanelClaim[] = [];
/** Claims the engine still makes, but through a TOKEN the producer creates rather than as a direct
 *  card-to-card pair. Reproduced on `Oath of Liliana -> Ayara, First of Locthwain`: Ayara triggers
 *  on a black creature entering, Oath is a Legendary ENCHANTMENT so it never enters as one, and the
 *  relation belongs to the 2/2 Zombie it makes. Same claim, said more precisely -- and counting it
 *  as a lost edge sends someone to fix an engine that is right. */
const reattributedKeys = new Set<string>();
/** The same, matched on the tag FAMILY only — see where it is filled for why that looseness is
 *  earned on the consumer side and is NOT applied on the producer side. */
const reattributedFamilies = new Set<string>();
/** `${producer}|${tokenConsumer}|${tag}` for every claim whose CONSUMER is a token node. */
const tokenDemands = new Set<string>();
const oracle = new Map<string, string>();
/** WHICH CARDS EACH DECK ACTUALLY RESOLVES TO TODAY, so a lost pair can be told apart from a verdict
 *  about a card that is not in the deck any more. Both are "the engine no longer claims this" and
 *  only one is a defect: on the 2026-09-07 reading, all 8 rotted pairs were the RESOLVER being FIXED
 *  — a decklist line "Rampant Growth" used to resolve to the split card `Studious First-Year //
 *  Rampant Growth`, whose corpus `searchNames` no longer carries the bare back-face name. */
const resolvedByDeck = new Map<string, Set<string>>();
const deckOfPair = new Map<string, string>();
for (const p of pairs) deckOfPair.set(`${p.producer}|${p.consumer}`, p.deck);
let missingDecks = 0;
for (const [deck, want] of wantedByDeck) {
  const file = `${DECKS}/${deck}.txt`;
  if (!existsSync(file)) { missingDecks++; continue; }
  const sections = parseDecklistSections(readFileSync(file, "utf8"));
  const { cards, combos } = await resolveNames([...sections.commanders, ...sections.deck], lookup);
  for (const c of cards) oracle.set(c.name, (c as { oracleText?: string }).oracleText ?? "");
  const cmd = new Set(sections.commanders.map(normalizeName));
  resolvedByDeck.set(deck, new Set(cards.map((c) => normalizeName(c.name))));
  const deckCards = await buildDeckCards(cards, lookup, tags);
  const report = analyzeDeckStructured(
    deckCards, cards.filter((c) => cmd.has(normalizeName(c.name))).map((c) => c.name),
    undefined, undefined, new ComboIndex(combos), undefined, tokenTags,
  );
  // EVERY reason, not just the panel's pairs: a claim the panel keys on two CARDS can now be
  // carried by a TOKEN one of them makes, and that hop is invisible if only wanted pairs are kept.
  const madeBy = new Map<string, Set<string>>();       // card -> tokens it creates
  const tokenClaims = new Set<string>();               // `${token}|${consumer}|${tag}`
  for (const e of report.edges) {
    for (const r of e.reasons) {
      if (!r.producer || !r.consumer) continue;
      if (r.tag.startsWith("creates:")) {
        if (!madeBy.has(r.producer)) madeBy.set(r.producer, new Set());
        madeBy.get(r.producer)!.add(r.consumer);
      }
      if (r.producerIsToken) tokenClaims.add(`${r.producer}|${r.consumer}|${r.tag}`);
      if (r.consumerIsToken) tokenDemands.add(`${r.producer}|${r.consumer}|${r.tag}`);
      if (!want.has(`${r.producer}|${r.consumer}`)) continue;
      current.push({ producer: r.producer, consumer: r.consumer, tag: r.tag, implied: r.impliedProducer === true });
    }
  }
  for (const [card, toks] of madeBy) {
    for (const t of toks) {
      // SUPPLY moved onto the token the producer makes: `Oath -> Zombie [token] -> Ayara`.
      for (const key of tokenClaims) {
        const [tk, consumer, tag] = key.split("|");
        if (tk === t) reattributedKeys.add(`${card}|${consumer}|${tag}`);
      }
      // DEMAND moved onto the token the CONSUMER makes, which is the same change on the other side
      // of the edge: Vivi's Persistence is not the payoff, the 0/1 Wizard it creates is, and the
      // Wizard is what carries "whenever you cast a noncreature spell".
      for (const key of tokenDemands) {
        const [producer, tk, tag] = key.split("|");
        if (tk !== t) continue;
        reattributedKeys.add(`${producer}|${card}|${tag}`);
        // FAMILY, not the exact tag, and only on this side. Seven of the nine consumer-side rows
        // ALSO changed tag -- panel `cast:artifact` -> live `cast:-creature` -- and the panel's tag
        // was simply WRONG: Chandra's Ignition is a Sorcery and never supplied `cast:artifact`. The
        // engine both re-attributed the claim and named it correctly, so requiring an exact match
        // would score a strict improvement as a loss. Exact-tag alone catches 2 of the 9.
        reattributedFamilies.add(`${producer}|${card}|${tag.split(":")[0]}`);
      }
    }
  }
}

// One claim, one verdict, one count. `pairReasons` can return the same (producer, consumer, tag)
// twice -- two reasons differing only by effectKind, the known display-layer duplicate -- and the
// panel keys verdicts by claim, so counting both would weight that claim double for no reason.
// (The sampling instrument counted reasons, duplicates included; the panel counts claims. The two
// measures are therefore not identical, which is one more reason not to compare their levels.)
const seenClaim = new Set<string>();
const distinct = current.filter((c) => {
  const k = `${c.producer}|${c.consumer}|${c.tag}`;
  if (seenClaim.has(k)) return false;
  seenClaim.add(k);
  return true;
});
console.log(`  (${current.length - distinct.length} duplicate claims collapsed)`);

// Every claim, judged or not, one per line. The headline moves for two different reasons — the
// engine claiming something new, or an old claim disappearing — and the number alone cannot tell
// them apart. Diffing this file across a change says exactly which claims arrived and which left.
const claimsOut = arg("--claims");
if (claimsOut) {
  writeFileSync(claimsOut, `${distinct.map((c) => `${c.producer}|${c.consumer}|${c.tag}`).sort().join("\n")}\n`);
}

// A deck we could not read says nothing, so its pairs are treated as still present: rot is only
// ever claimed on evidence, and the fallback direction over-reports regression rather than under.
const pairInDeck = (producer: string, consumer: string): boolean => {
  const present = resolvedByDeck.get(deckOfPair.get(`${producer}|${consumer}`) ?? "");
  if (!present) return true;
  return present.has(normalizeName(producer)) && present.has(normalizeName(consumer));
};

const reattributed = (producer: string, consumer: string, tag: string): boolean =>
  reattributedKeys.has(`${producer}|${consumer}|${tag}`)
  || reattributedFamilies.has(`${producer}|${consumer}|${tag.split(":")[0]}`);

let exitCode = 0;
const s = scorePanel(distinct, cache, pairInDeck, reattributed);
const [lo, hi] = wilsonPanel(s.real, s.real + s.false);
console.log(`frozen panel — ${pairs.length} pairs, ${cache.length} cached verdicts`);
if (missingDecks) console.log(`  decks not found: ${missingDecks}`);
console.log(`  claims the engine makes on the panel today: ${distinct.length}`);
console.log(`  real ${s.real} | false ${s.false} | uncertain ${s.uncertain}`);
console.log(`  PRECISION ${s.precision === null ? "n/a" : `${(s.precision * 100).toFixed(1)}% [${lo.toFixed(1)}, ${hi.toFixed(1)}]`}`);
console.log(`  judging DEBT (claims with no verdict): ${s.unjudged.length}`);
// The debt is not a footnote: until it is judged, precision is only bounded. Printing the bound
// stops the headline being read as settled when a third of the claims are unaccounted for.
if (s.unjudged.length) {
  const worst = s.real / (s.real + s.false + s.unjudged.length);
  const best = (s.real + s.unjudged.length) / (s.real + s.false + s.unjudged.length);
  console.log(`    -> until it is judged, true panel precision is bounded [${(worst * 100).toFixed(1)}, ${(best * 100).toFixed(1)}]`);
}
// PRECISION ALONE CANNOT BE COMPARED ACROSS A CHANGE THAT SHRINKS THE CLAIM SET, which is what
// every de-meshing ruling does. A gate that deletes every claim it is unsure of scores 100%, so the
// pairs the panel judged REAL and the engine no longer joins are printed beside the headline rather
// than left for someone to work out from `dropped`.
// RETENTION, NOT RECALL, and the distinction is not pedantry. The denominator is pairs the panel
// judged REAL, and the panel was BUILT from claims this engine already made (`panel-build.ts`), so
// every opportunity here is an edge the engine once found. It cannot see a true edge the engine has
// NEVER claimed. The instrument that can is `recall-sample.ts` / `recall-core.ts`, whose one draw
// (2026-08-06, 201 silent pairs) found 28 misses and has not been re-run since.
console.log(`  RETENTION of pairs judged real: ${s.recall === null ? "n/a" : `${(s.recall * 100).toFixed(1)}%`} (${s.recallHeld} held, ${s.recallLost} lost)`);
console.log(`    NOT recall — every pair here is one the engine once claimed; a never-claimed edge is invisible to it`);
// THE GUARD IS A NAMED SET, not a percentage. A floor at "recall >= 91%" would let one lost edge
// hide behind one recovered edge and read green while the contents rotted -- the failure this repo
// already writes down as "compare by NAME, not by count". Same shape as `derive-compass.test.ts`'s
// `expect(regressions).toEqual([])`, and it fails in BOTH directions so a gain has to be banked.
//
// The list sits beside the panel it describes, under `docs/measurements/`, which is LOCAL ONLY.
// That is deliberate: it is derived from the verdicts, and publishing it is the same disclosure
// decision as publishing the panel. It also cannot run in CI for the same reason panel-score
// cannot -- this needs Mongo -- so it guards where the change is made rather than where it merges.
const KNOWN_LOST = `${PANEL}/known-lost-pairs.json`;
// READ IT, DO NOT ASK WHETHER IT EXISTS FIRST. `existsSync` then `readFileSync` is a check-then-use
// race (CodeQL js/file-system-race, raised on this very line), and the try/catch is smaller code:
// one read, and "absent" is just the failure case. `null` means the list has never been banked.
const known: string[] | null = (() => {
  try {
    return (JSON.parse(readFileSync(KNOWN_LOST, "utf8")) as { pairs: string[] }).pairs;
  } catch {
    return null;
  }
})();
if (process.argv.includes("--bank")) {
  writeFileSync(KNOWN_LOST, `${JSON.stringify({ pairs: s.lostPairs }, null, 1)}\n`);
  console.log(`\n  banked ${s.lostPairs.length} lost pairs -> ${KNOWN_LOST}`);
} else if (known === null) {
  console.log(`\n  no ${KNOWN_LOST} yet — run with --bank to record the ${s.lostPairs.length} current losses`);
} else {
  const { added, recovered } = ratchetLostPairs(s.lostPairs, known);
  if (added.length) {
    console.log(`\n  RATCHET FAILED — ${added.length} pair(s) the panel judged REAL are newly unjoined:`);
    for (const p of added) console.log(`    + ${p}`);
  }
  if (recovered.length) {
    console.log(`\n  RATCHET FAILED — ${recovered.length} pair(s) recovered and were never banked:`);
    for (const p of recovered) console.log(`    - ${p}`);
    console.log(`    (this is GOOD news; re-run with --bank so the gain cannot be spent silently)`);
  }
  if (!added.length && !recovered.length) console.log(`\n  ratchet: ok — the ${known.length} known losses are exactly the ones still lost`);
  exitCode = added.length || recovered.length ? 1 : 0;
}

console.log(`  cached verdicts the engine no longer claims: ${s.dropped}`);
console.log(`    ${s.droppedFalse} were judged FALSE — the engine stopped making a wrong claim, which is a win`);
console.log(`    ${s.droppedUncertain} were judged UNCERTAIN — neither a win nor a loss`);
console.log(`    of the ones judged REAL:`);
console.log(`      ${s.droppedRetag} retag (the pair still joins under another tag — not a loss)`);
console.log(`      ${s.droppedRot} rot (a card named by the verdict is not in that deck any more)`);
console.log(`      ${s.droppedReattributed} re-attributed (still claimed, via a token one side of the pair makes)`);
console.log(`      ${s.droppedRegression} REGRESSION (both cards still there, the pair no longer joins)`);

// `--rejudge` dumps EVERY live claim, judged or not, in the same worksheet shape. The cached
// verdicts the engine no longer claims are excluded on purpose: re-judging a claim nothing makes
// changes no reported number. (This comment said "the 608" until 2026-09-07, when the real figure
// was 704 — a count written into prose is a count that goes stale, so it is printed, not narrated.) Rows already carrying a USER verdict are excluded too -- the user is
// the authority, so re-judging them would be overwriting the answer with the thing being tested.
const rejudge = arg("--rejudge");
if (rejudge) {
  const userJudged = new Set(cache.filter((v) => v.note.startsWith("USER VERDICT"))
    .map((v) => `${v.producer}|${v.consumer}|${v.tag}`));
  const rows = distinct.filter((c) => !userJudged.has(`${c.producer}|${c.consumer}|${c.tag}`));
  writeFileSync(rejudge, `${rows.map((c, id) => JSON.stringify({
    id, producer: c.producer, consumer: c.consumer, tag: c.tag,
    claim: claimFor(c.tag, c.producer, c.consumer, c.implied === true),
    producerOracle: oracle.get(c.producer) ?? "", consumerOracle: oracle.get(c.consumer) ?? "",
  })).join("\n")}\n`);
  console.log(`  wrote ${rows.length} live claims to re-judge (${distinct.length - rows.length} are the user's) -> ${rejudge}`);
}

// `--falses` dumps the claims judged FALSE, with the note they were judged under and both oracle
// texts — the work list for any precision item. Roadmap C7 was this list, transcribed by hand on
// 2026-08-20, and it was stale by 41 claims two days later because false fell 63 -> 22 under six
// separate fixes. A list that has to be re-typed to stay true is a list that stops being true.
const falsesOut = arg("--falses");
if (falsesOut) {
  writeFileSync(falsesOut, `${s.falses.map(({ claim: c, note }, id) => JSON.stringify({
    id, producer: c.producer, consumer: c.consumer, tag: c.tag,
    claim: claimFor(c.tag, c.producer, c.consumer, c.implied === true),
    note, producerOracle: oracle.get(c.producer) ?? "", consumerOracle: oracle.get(c.consumer) ?? "",
  })).join("\n")}\n`);
  console.log(`  wrote ${s.falses.length} false claims -> ${falsesOut}`);
}

// `--live` dumps EVERY distinct live claim (judged or not) as triples, so two runs of the engine can
// be diffed claim by claim -- which is the only way to name the REAL claims a fix deleted, rather
// than read them off a shrinking count.
const live = arg("--live");
if (live) {
  writeFileSync(live, distinct.map((c) => JSON.stringify({ producer: c.producer, consumer: c.consumer, tag: c.tag, implied: c.implied === true })).join("\n") + "\n");
  console.log(`  wrote ${distinct.length} live claims -> ${live}`);
}
const out = arg("--worksheet");
if (out && s.unjudged.length) {
  writeFileSync(out, `${s.unjudged.map((c, id) => JSON.stringify({
    id, producer: c.producer, consumer: c.consumer, tag: c.tag,
    claim: claimFor(c.tag, c.producer, c.consumer, c.implied === true),
    producerOracle: oracle.get(c.producer) ?? "", consumerOracle: oracle.get(c.consumer) ?? "",
  })).join("\n")}\n`);
  console.log(`\n  wrote the debt as a worksheet -> ${out}`);
}
await store.close();
// Non-zero when the named ratchet moved in either direction, so a script or a shell `&&` sees it.
process.exitCode = exitCode;
