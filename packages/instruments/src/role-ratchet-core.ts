/** PURE CORE of the by-name role ratchet (#1266). A membership is `role:<category>` or
 *  `answer:<class>` or `wincon:<class>`, keyed BY CARD: the detectors read one card and the rule set, nothing of the
 *  deck, so a card's memberships cannot differ between decks. */
export type Membership = Record<string, string[]>;

export interface MembershipDiff {
  gained: [string, string][];
  lost: [string, string][];
  newCards: string[];
  goneCards: string[];
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Union per card over any number of per-deck maps; keys sorted and de-duplicated. */
export function mergeMembership(perDeck: Iterable<Map<string, string[]>>): Membership {
  const acc = new Map<string, Set<string>>();
  for (const deck of perDeck) {
    for (const [card, keys] of deck) {
      let s = acc.get(card);
      if (!s) { s = new Set(); acc.set(card, s); }
      for (const k of keys) s.add(k);
    }
  }
  const out: Membership = {};
  for (const card of [...acc.keys()].sort(cmp)) out[card] = [...acc.get(card)!].sort(cmp);
  return out;
}

/** `snapshot` is the banked truth, `measured` is today. Both directions are changes. */
export function diffMembership(measured: Membership, snapshot: Membership): MembershipDiff {
  const gained: [string, string][] = [], lost: [string, string][] = [];
  const newCards: string[] = [], goneCards: string[] = [];
  const cards = [...new Set([...Object.keys(measured), ...Object.keys(snapshot)])].sort(cmp);
  for (const card of cards) {
    const m = measured[card], s = snapshot[card];
    if (m && !s) newCards.push(card);
    if (s && !m) goneCards.push(card);
    const have = new Set(m ?? []), had = new Set(s ?? []);
    for (const k of [...have].sort(cmp)) if (!had.has(k)) gained.push([card, k]);
    for (const k of [...had].sort(cmp)) if (!have.has(k)) lost.push([card, k]);
  }
  return { gained, lost, newCards, goneCards };
}

/** One card per line so a membership change is a one-line git diff. */
export function serialiseSnapshot(m: Membership): string {
  const cards = Object.keys(m).sort(cmp);
  return `{\n${cards.map((c) => `${JSON.stringify(c)}: ${JSON.stringify([...m[c]].sort(cmp))}`).join(",\n")}\n}\n`;
}

/** A `deriveVersion` group-count row, as `$group` returns it (`_id` is null for a row that has none). */
export interface VersionGroup { _id: number | null; n: number }

/** The groups that are NOT the expected version -- newer ones too, since the snapshot is only
 *  comparable to a corpus derived at exactly the version the checked-out code carries. */
export function versionDrift(groups: readonly VersionGroup[], expected: number): VersionGroup[] {
  return groups.filter((g) => g._id !== expected).sort((a, b) => (a._id ?? -1) - (b._id ?? -1));
}

/** Up to `max` names, then a count of the rest. */
export function listSome(names: readonly string[], max = 10): string {
  const head = [...names].sort(cmp).slice(0, max).join(", ");
  return names.length > max ? `${head}, ... (+${names.length - max} more)` : head;
}
