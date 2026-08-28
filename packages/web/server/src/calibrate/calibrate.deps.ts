/** Live-corpus half of the calibration tool: sampling against the derived corpus, and writing the
 *  verdict plus the clause snapshot that lets the gate run offline.
 *
 *  Kept out of `data.module.ts` because that file is already the size of two modules, and this one
 *  has a concern of its own — it WRITES to the repository. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "mongodb";
import type * as matcherTypes from "@mtg/matcher";
import type { CalibrateDeps, CalibratePair, CalibrateCard, VerdictRequest } from "./calibrate.service.js";

/** Where the judged data lives. Relative to the repo root, because the verdicts are source. */
const PAIRS_FILE = "packages/matcher/src/calibration-pairs.json";
const FIXTURE_FILE = "packages/matcher/src/fixtures/calibration-clauses.json";

const readJson = <T>(path: string, fallback: T): T => {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
};

/** One reader-facing line per ability, so a judge can see a mistagged card without reading code. */
function renderTags(tags: { abilities?: unknown[] } | null): string[] {
  const abilities = (tags?.abilities ?? []) as Array<{
    kind?: string;
    trigger?: { verbs?: string[]; subject?: Record<string, unknown> };
    effect?: { kind?: string; subject?: Record<string, unknown> };
    emits?: Array<{ verb?: string; subject?: Record<string, unknown> }>;
  }>;
  if (abilities.length === 0) return ["(no abilities derived)"];
  const subj = (s?: Record<string, unknown>): string => {
    if (!s) return "";
    const bits = [
      s.self ? "SELF" : "",
      s.token === true ? "token" : s.token === false ? "nontoken" : "",
      Array.isArray(s.type) ? s.type.join("/") : (s.type as string) ?? "",
      Array.isArray(s.subtype) ? s.subtype.join("/") : (s.subtype as string) ?? "",
      s.control && s.control !== "any" ? `${s.control as string}-controlled` : "",
    ].filter(Boolean);
    return bits.length ? ` [${bits.join(" ")}]` : "";
  };
  return abilities.map((a) => {
    const parts = [a.kind ?? "?"];
    if (a.trigger?.verbs?.length) parts.push(`on ${a.trigger.verbs.join("/")}${subj(a.trigger.subject)}`);
    if (a.effect?.kind) parts.push(`does ${a.effect.kind}${subj(a.effect.subject)}`);
    for (const e of a.emits ?? []) parts.push(`emits ${e.verb}${subj(e.subject)}`);
    return parts.join(" · ");
  });
}

export async function makeCalibrateDeps(store: { db: Db }, repoRoot: string): Promise<CalibrateDeps> {
  const data = await import("@mtg/data");
  const matcher = await import("@mtg/matcher");
  const hierarchy = matcher.loadHierarchy();

  /** Built once: the derived corpus is the sampling universe, and re-reading it per request would
   *  make every judgement wait on a full collection scan. */
  const derived = await store.db.collection("cardTagsDerived").find({}).toArray();
  const docsById = new Map(derived.map((d) => [d.oracleId as string, d]));
  const cards = await store.db.collection("cards")
    .find({ _id: { $in: [...docsById.keys()] } as never }).toArray();
  const cardByName = new Map(cards.map((c) => [c.name as string, c]));
  const tagsByName = new Map<string, unknown>();
  const themeByName: { name: string; tags: ReadonlySet<string> }[] = [];
  for (const c of cards) {
    const t = docsById.get(c._id as unknown as string);
    if (!t) continue;
    tagsByName.set(c.name as string, t);
    themeByName.push({ name: c.name as string, tags: matcher.cardThemeTags(t as never) });
  }
  const tagIndex = matcher.buildTagIndex(themeByName);
  const names = [...tagsByName.keys()];

  const deckCard = (name: string): unknown => ({
    card: data.docToCard(cardByName.get(name) as never),
    tags: tagsByName.get(name),
  });
  // ACROSS FACES, because that is what the engine ships. `pairReasons` reads whatever type line and
  // ability list the `DeckCard` carries -- the COMBINED card for a multi-face one -- while
  // `analyzeDeckStructured` splits with `faceDeckCards` first and matches each face with only the
  // abilities it prints. Judging against the unsplit read means the owner is judging an engine that
  // no longer exists, and the verdict is then frozen into the ratchet. Review fix, 2026-08-28. The
  // offline gate (`pair-calibration.test.ts`) calls the same function, so the tool and the gate
  // cannot disagree about a pair.
  const reasonsFor = (a: string, b: string): string[] =>
    matcher.pairReasonsAcrossFaces(deckCard(a) as never, deckCard(b) as never, hierarchy).map((r) => r.text);

  const card = (name: string): CalibrateCard => {
    const doc = cardByName.get(name) as unknown as { name: string; typeLine?: string; oracleText?: string };
    return {
      name: doc.name,
      typeLine: doc.typeLine ?? "",
      oracleText: doc.oracleText ?? "",
      tags: renderTags(tagsByName.get(name) as never),
    };
  };

  return {
    async samplePair(): Promise<CalibratePair | null> {
      if (names.length < 2) return null;
      const stratum = matcher.pickStratum(Math.random());
      // Bounded retries: `linked` and `shared-tag` are both conditions a random draw may miss, and
      // an unbounded loop would hang the request rather than fail it. Falling back to whatever the
      // last draw produced would silently corrupt the strata, so it gives up instead.
      for (let attempt = 0; attempt < 400; attempt++) {
        const pair = stratum === "random"
          ? matcher.randomPair(names, Math.random)
          : matcher.candidateFromTagIndex(tagIndex, Math.random);
        if (!pair) break;
        const engineReasons = reasonsFor(pair[0], pair[1]);
        const ok = stratum === "linked" ? engineReasons.length > 0
          : stratum === "shared-tag" ? engineReasons.length === 0
          : true;
        if (!ok) continue;
        return { a: card(pair[0]), b: card(pair[1]), stratum, engineReasons };
      }
      return null;
    },

    async record(v: VerdictRequest) {
      const pairsPath = join(repoRoot, PAIRS_FILE);
      const fixturePath = join(repoRoot, FIXTURE_FILE);
      const pairs = readJson<matcherTypes.PairRecord[]>(pairsPath, []);
      const fixtures = readJson<matcherTypes.ClauseFixture[]>(fixturePath, []);

      // The verdict is only half the record. Without the clause snapshot the gate would need a
      // database, and a gate that needs a database does not run in CI.
      const clauses = await store.db.collection("cardClauses")
        .find({ name: { $in: [v.a, v.b] } }).toArray();
      // `characteristics` comes off the DERIVED doc rather than being recomputed from the card:
      // that is the exact object the matcher reads today, so the fixture cannot drift from what the
      // live engine sees.
      // Clause id -> text, snapshotted alongside. Derivation reads it to recover who performs an
      // action when the clause names an actor the object does not carry ("its controller creates a
      // 3/3 Ape"). The gate has no database and so no oracle text to segment; without this the
      // fixture would derive different tags from the ones the judge was shown.
      const tagger = await import("@mtg/tagger");
      const cardDocs = await store.db.collection("cards")
        .find({ name: { $in: [v.a, v.b] } }).toArray();
      const textsFor = (name: string): Record<number, string> => {
        const d = cardDocs.find((c) => c.name === name);
        const out: Record<number, string> = {};
        for (const c of tagger.segment(d?.oracleText ?? "", d?.keywords ?? [], d?.typeLine ?? "")) {
          out[c.id] = c.text;
        }
        return out;
      };
      const snapshot = clauses.map((c) => ({
        name: c.name as string,
        oracleId: c.oracleId as string,
        clauses: c.canonical as never,
        characteristics: (tagsByName.get(c.name as string) as { characteristics: never }).characteristics,
        clauseTexts: textsFor(c.name as string),
      }));

      const engineLinks = reasonsFor(v.a, v.b).length > 0;
      const next: matcherTypes.PairRecord = {
        a: v.a, b: v.b, verdict: v.verdict, stratum: v.stratum,
        ...(v.tagDefects?.length ? { tagDefects: v.tagDefects } : {}),
        ...(v.note ? { note: v.note } : {}),
        // Recorded at judging time rather than left for the test to discover: the engine will
        // change, and this marks what it believed WHEN the human answered.
        ...(engineLinks !== (v.verdict === "synergy") ? { knownDefect: true } : {}),
        judgedAt: new Date().toISOString(),
      };

      const allPairs = matcher.upsertPair(pairs, next);
      writeFileSync(pairsPath, `${JSON.stringify(allPairs, null, 1)}\n`);
      writeFileSync(fixturePath, `${JSON.stringify(matcher.mergeFixtures(fixtures, snapshot as never), null, 1)}\n`);
      return {
        total: allPairs.length,
        knownDefects: allPairs.filter((p) => p.knownDefect).length,
      };
    },
  };
}
