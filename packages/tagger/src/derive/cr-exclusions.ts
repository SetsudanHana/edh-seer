/** CR 701 keyword actions accounted for OUTSIDE the vocabularies, shared by the two completeness
 *  ratchets (`cr-completeness.test.ts` for VERBS, `trigger-completeness.test.ts` for TRIGGERS) so
 *  one list of exclusions is judged once.
 *
 *  Each entry is excluded on LEGALITY — the card can never appear in an EDH decklist — and never on
 *  "no demand", which is the exclusion the vocabulary ruling forbids. */
export const EXCLUDED_701: Record<string, string> = {
  activate: "not an action a card text states; it is what an activated ability IS (ability kind)",
  assemble: "Unstable/silver-bordered. CR 701.45a itself says those cards 'aren't included in these rules'",
  planeswalk: "Planechase. No plane is ever in a decklist",
  "set in motion": "Archenemy scheme. Never in a decklist",
  abandon: "Archenemy scheme. Never in a decklist",
  "open an attraction": "Unfinity Attractions live in a separate deck, never the 99",
  "roll to visit your attractions": "Unfinity Attractions, as above",
};

/** CR English -> our VERBS spelling, only where they differ. */
export const VERB_ALIASES_701: Record<string, string> = {
  counter: "counter-spell",
  "tap and untap": "tap",
  "venture into the dungeon": "venture-into-the-dungeon",
  "the ring tempts you": "ring-tempts",
  "time travel": "time-travel",
  "collect evidence": "collect-evidence",
  "manifest dread": "manifest-dread",
  "face a villainous choice": "face-a-villainous-choice",
};
