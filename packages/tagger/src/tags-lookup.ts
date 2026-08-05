/** Which tag population a reader sees, and how the two are composed.
 *
 *  After the first paid run only part of the corpus has derived tags — coverage measurement puts a
 *  newly built deck near half derived, half flat — so an all-or-nothing collection switch would
 *  blank every card outside the purchased scope. Composition, not switching.
 *
 *  Mixing was measured before this was built (`packages/matcher/src/bin/mixed-population.ts`): over
 *  the 55 verified gold pairs, every pair passing in both pure arms also passes in both mixed arms.
 *  No edge is lost to the two populations disagreeing, in either direction.
 *
 *  Default is `derived` as of 2026-08-06, on the edge-precision measurement: 300 reasons sampled per
 *  population and judged blind put derived at 69.0% [58.5, 77.9] against flat's 18.0% [12.7, 24.9],
 *  non-overlapping on every view including the blinding-leak audit. Derived reports roughly a third
 *  of flat's reasons and is roughly four times as precise; the reasons it drops are mostly the false
 *  ones. See `docs/superpowers/specs/2026-08-05-edge-precision-measurement-design.md`.
 *
 *  `derived` rather than `derived-first`, deliberately. The fallback would serve flat tags for any
 *  card outside the purchased corpus, and flat's precision is 18% — 83 of its false rows are a
 *  single defect (a self-ETB read as a payoff for every permanent entering) that its tags carry no
 *  marker to escape. This project treats a silent wrong answer as worse than a missing one. Set
 *  TAGS_SOURCE=derived-first to trade that back for coverage. */
import type { Db } from "mongodb";
import type { CardTags } from "./schema.js";
import { DERIVED_COLLECTION } from "./clause-store.js";

export type TagsSource = "flat" | "derived-first" | "derived";

const SOURCES: readonly TagsSource[] = ["flat", "derived-first", "derived"];

/** Structurally compatible with matcher's `CardTagsLookup`, declared here so the collections stay
 *  owned by the package that writes them and no import cycle is needed. */
export interface TagsReader {
  findOne(oracleId: string): Promise<CardTags | null>;
}

/** Reads `TAGS_SOURCE`, defaulting to `derived`.
 *
 *  Throws on anything unrecognised rather than falling back. A typo (`dervied`) that quietly served
 *  flat would look exactly like a working derived deployment while returning the old population —
 *  the silent-wrong-answer class this project treats as worse than a missing answer. */
export function resolveTagsSource(env: Record<string, string | undefined> = process.env): TagsSource {
  const raw = env.TAGS_SOURCE;
  if (raw === undefined || raw === "") return "derived";
  if ((SOURCES as readonly string[]).includes(raw)) return raw as TagsSource;
  throw new Error(`TAGS_SOURCE="${raw}" is not one of: ${SOURCES.join(", ")}`);
}

/** `derived` deliberately does NOT fall back — it exists to measure the derived population on its
 *  own, and a fallback would quietly mix flat results into that measurement. */
export function composeTagsLookup(flat: TagsReader, derived: TagsReader, source: TagsSource): TagsReader {
  if (source === "flat") return flat;
  if (source === "derived") return derived;
  return {
    async findOne(oracleId: string) {
      return (await derived.findOne(oracleId)) ?? (await flat.findOne(oracleId));
    },
  };
}

/** The wiring every read site should use, so none of them hand-rolls a collection query. */
export function createTagsLookup(db: Db, source: TagsSource = resolveTagsSource()): TagsReader {
  const flatCol = db.collection<CardTags>("cardTags");
  const derivedCol = db.collection<CardTags>(DERIVED_COLLECTION);
  return composeTagsLookup(
    { findOne: (oracleId) => flatCol.findOne({ oracleId }) },
    { findOne: (oracleId) => derivedCol.findOne({ oracleId }) },
    source,
  );
}
