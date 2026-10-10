import { faceKey } from "@edh-seer/matcher/face-key";

/** The node fields the label join reads. */
interface LabelNode { id: string; label: string; cardName?: string; isToken?: boolean }

/** EVERY NAME A DECK CARD GOES BY, MAPPED TO ITS NODE (#1176). The first-listed node of a label used
 *  to win, so a face listed ahead of a real card of the same name ("Grave Researcher // Reanimate"
 *  before "Reanimate") took the real card's name. Now:
 *   1. a STANDALONE card (no `cardName`) wins its printed label over any face;
 *   2. a face takes its printed label only if no one has;
 *   3. a face is ALWAYS reachable under `faceKey(label, cardName)` -- the key the report gives a
 *      face row whose name collides, and the form reason sentences print.
 *  A token never wins (see the callers). `pick` returns the value stored; a node it returns
 *  undefined for is skipped, as the art map skips a node with no art. */
export function indexByLabel<N extends LabelNode, T>(nodes: readonly N[], pick: (n: N) => T | undefined): Map<string, T> {
  const m = new Map<string, T>();
  // A label is CLAIMED by a standalone card BEFORE `pick` is asked: a standalone with no art (or
  // whatever `pick` refuses) leaves the label unset rather than handing it to a colliding face.
  const claimed = new Set<string>();
  const cards = nodes.filter((n) => !n.isToken);
  for (const n of cards) {
    if (n.cardName !== undefined || claimed.has(n.label)) continue;
    claimed.add(n.label);
    const v = pick(n);
    if (v !== undefined) m.set(n.label, v);
  }
  for (const n of cards) {
    if (n.cardName === undefined) continue;
    const v = pick(n);
    if (v === undefined) continue;
    if (!claimed.has(n.label)) { claimed.add(n.label); m.set(n.label, v); }
    m.set(faceKey(n.label, n.cardName), v);
  }
  return m;
}

/** The printed face name a report row's key stands for: "Rampant Growth (Studious First-Year //
 *  Rampant Growth)" reads "Rampant Growth". Only the faceKey forms of face nodes are listed. */
export function faceLabels(nodes: readonly LabelNode[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const n of nodes) if (!n.isToken && n.cardName !== undefined) m.set(faceKey(n.label, n.cardName), n.label);
  return m;
}
