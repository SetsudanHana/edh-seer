export interface Combo {
  /** Names of every card required for the combo. */
  cards: string[];
  /** Human-readable result, e.g. "Win the game." */
  result: string;
}

export class ComboIndex {
  constructor(private readonly combos: Combo[]) {}

  /** All combos whose entire card set is present in `names`. */
  combosContainedIn(names: Set<string>): Combo[] {
    return this.combos.filter((c) => c.cards.every((name) => names.has(name)));
  }
}
