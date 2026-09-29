export interface Combo {
  /** Names of every card required for the combo. */
  cards: string[];
  /** Human-readable result, e.g. "Win the game." */
  result: string;
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
