import type { Ability, CardTags, SubjectFilter } from "./schema.js";

export interface CardScore {
  oracleId: string;
  charsExact: boolean;
  abilityTP: number;
  abilityFP: number;
  abilityFN: number;
}

export interface Report {
  cards: CardScore[];
  charsExactRate: number;
  precision: number;
  recall: number;
  f1: number;
}

export function scoreCard(predicted: CardTags, gold: CardTags): CardScore {
  const charsExact =
    canonical(predicted.characteristics) === canonical(gold.characteristics);

  const predSet = new Set(predicted.abilities.map(abilityKey));
  const goldSet = new Set(gold.abilities.map(abilityKey));

  const abilityTP = countMatches(goldSet, predSet);
  const abilityFN = goldSet.size - countMatches(goldSet, predSet);
  const abilityFP = predSet.size - countMatches(predSet, goldSet);

  return { oracleId: gold.oracleId, charsExact, abilityTP, abilityFP, abilityFN };
}

function countMatches(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const k of a) if (b.has(k)) n++;
  return n;
}

/** The scored canonical keys for a set of abilities — exposed for diffing predicted vs gold. */
export function abilityKeys(abilities: Ability[]): string[] {
  return abilities.map(abilityKey);
}

/** Canonical string of the scored ability fields: verbs + subject + effect.kind. */
function abilityKey(a: Ability): string {
  const verbs = a.trigger ? [...a.trigger.verbs].sort().join("|") : "";
  const subject = a.trigger ? subjectKey(a.trigger.subject) : "";
  return `${a.kind}::${verbs}::${subject}::${a.effect.kind}`;
}

/** Normalize a string-or-array field to a sorted array so "x" ≡ ["x"] and order is irrelevant. */
function normList(v: string | string[] | undefined): string[] | null {
  if (v === undefined) return null;
  return (Array.isArray(v) ? [...v] : [v]).sort();
}

function subjectKey(s: SubjectFilter): string {
  return JSON.stringify({
    type: normList(s.type),
    subtype: normList(s.subtype),
    colors: s.colors ? [...s.colors].sort() : null,
    control: s.control,
    token: s.token,
    chosenType: s.chosenType ?? false,
    counter: s.counter ?? null,
    zone: s.zone ?? null,
  });
}

function canonical(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as object).sort());
}

export function aggregate(scores: CardScore[]): Report {
  const tp = sum(scores, (s) => s.abilityTP);
  const fp = sum(scores, (s) => s.abilityFP);
  const fn = sum(scores, (s) => s.abilityFN);
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const charsExactRate =
    scores.length === 0 ? 1 : scores.filter((s) => s.charsExact).length / scores.length;
  return { cards: scores, charsExactRate, precision, recall, f1 };
}

function sum(scores: CardScore[], f: (s: CardScore) => number): number {
  return scores.reduce((acc, s) => acc + f(s), 0);
}
