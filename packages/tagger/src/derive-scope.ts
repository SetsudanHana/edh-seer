/** WHICH CARDS `derive-corpus` DERIVES (Mongo filter). Commander-legal cards, plus unreleased spoiler
 *  cards (owner 2026-10-25): Scryfall marks those `not_legal` in every format until release, but they
 *  are previewed -- derived, paged, playable -- so `upcoming` is taken as legal here.
 *
 *  ONLY derive-corpus WIDENS. `normalize-corpus` spends money and `role-ratchet`, `dropped-clauses`
 *  and `gen-rate-stats` are ratchets whose populations must stay stable; they keep the raw
 *  `legalities.commander` filter on purpose. */
export const deriveScopeFilter = (): Record<string, unknown> => ({
  $or: [{ "legalities.commander": "legal" }, { upcoming: { $exists: true } }],
});
