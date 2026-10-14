/** MongoDB filter selecting non-gameplay junk card docs: doubled-name art/token
 *  printings ("Card // Card") and any doc whose oracle text is the bare
 *  face-join sentinel. Deliberately excludes blank oracle text — that also
 *  matches real vanilla creatures (e.g. Grizzly Bears). */
export function junkCardFilter(): Record<string, unknown> {
  return {
    $or: [
      { typeLine: "Card // Card" },
      { oracleText: { $in: ["//", "\n//\n"] } },
    ],
  };
}

/** Every per-card collection and the field that keys a card in it. `cards` and `cardOtags` use the
 *  document `_id` (the oracle id); the three tagger layers carry it as `oracleId`. `tokens` is keyed
 *  by token, not card, and `combos` by card NAME -- neither is touched (a combo naming a dropped card
 *  is a re-ingest matter, not a per-card row). */
export const PER_CARD_COLLECTIONS: readonly { collection: string; field: "_id" | "oracleId" }[] = [
  { collection: "cards", field: "_id" },
  { collection: "cardOtags", field: "_id" },
  { collection: "cardClauses", field: "oracleId" },
  { collection: "cardTags", field: "oracleId" },
  { collection: "cardTagsDerived", field: "oracleId" },
];

/** The delete filters that remove the given cards from every per-card collection. */
export function stickerPurgeFilters(ids: readonly string[]): { collection: string; filter: Record<string, unknown> }[] {
  return PER_CARD_COLLECTIONS.map(({ collection, field }) => ({ collection, filter: { [field]: { $in: [...ids] } } }));
}

/** The names a combo may use for a card: the whole name and each face of "A // B". */
export function comboNamesOf(cardName: string): string[] {
  return [...new Set([cardName, ...cardName.split(" // ")])];
}

/** The filter for combos naming any of the given cards (Commander Spellbook lists pieces by name). */
export function stickerComboFilter(names: Iterable<string>): Record<string, unknown> {
  return { cards: { $in: [...names] } };
}
