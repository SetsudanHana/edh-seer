export interface Combo {
  /** Names of every card required for the combo. */
  cards: string[];
  /** Human-readable result, e.g. "Win the game." */
  result: string;
  /** PIECES THE COMBO NEEDS THAT ARE NOT ONE NAMED CARD (#568): Commander Spellbook's templates, such
   *  as "Creature with undying", once per copy needed. A combo whose `cards` are two names and whose
   *  `requires` is not empty is a three-piece combo, whatever `cards.length` says. Absent on combos
   *  ingested before this field existed. */
  requires?: string[];
  /** THE DECK'S CARDS THAT TURN THIS LOOP INTO A WIN, beyond its own pieces: each eats one of the
   *  events the loop repeats and reaches the opponents (`@edh-seer/matcher`'s `comboPayoffs`).
   *  Absent on the index's own rows; set on a report's combos only. */
  payoffs?: { name: string; on: string[]; effect: string }[];
}

export class ComboIndex {
  constructor(private readonly combos: Combo[]) {}

  /** All combos whose entire card set is present in `names`. */
  combosContainedIn(names: Set<string>): Combo[] {
    return this.combos.filter((c) => c.cards.every((name) => names.has(name)));
  }
}
