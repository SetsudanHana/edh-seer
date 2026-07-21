import type { Reason } from "@mtg/engine";
import type { CardTags, GameEvent, SubjectFilter } from "@mtg/tagger";
import type { DeckCard, Hierarchy } from "./types.js";
import { subjectMatches } from "./subject.js";
import { impliedEvents } from "./implied.js";

const list = (v: string | string[] | undefined): string[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

/** A short human/grouping key for a subject: its subtype, else its type, else "any". */
export function themeSubjectKey(s: SubjectFilter): string {
  return list(s.subtype)[0] ?? list(s.type)[0] ?? "any";
}

/** A card's set of theme tags (for deck-frequency ranking): one per trigger verb, emit, and
 *  static effect. Mirrors the flat engine's produces∪cares membership. */
export function cardThemeTags(tags: CardTags): Set<string> {
  const out = new Set<string>();
  for (const a of tags.abilities) {
    if (a.trigger) for (const v of a.trigger.verbs) out.add(`${v}:${themeSubjectKey(a.trigger.subject)}`);
    for (const e of a.emits ?? []) out.add(`${e.verb}:${themeSubjectKey(e.subject)}`);
    if (a.kind === "static" && a.effect.subject) out.add(`static:${a.effect.kind}`);
  }
  return out;
}

/** The card's characteristics expressed as a concrete subject, for static-edge matching. */
function characteristicsSubject(tags: CardTags): SubjectFilter {
  const c = tags.characteristics;
  return {
    type: c.types.length ? c.types.map((t) => t.toLowerCase()) : undefined,
    subtype: c.subtypes.length ? c.subtypes.map((t) => t.toLowerCase()) : undefined,
    colors: c.colors.length ? c.colors : undefined,
    control: "you",
    token: c.token,
  };
}

/** A producer card's events: its authored emits unioned with the events implied by its own
 *  characteristics (being cast / entering the battlefield), de-duplicated. */
function producerEvents(tags: CardTags): GameEvent[] {
  const authored = tags.abilities.flatMap((a) => a.emits ?? []);
  const seen = new Set(authored.map((e) => JSON.stringify(e)));
  const out = [...authored];
  for (const e of impliedEvents(tags.characteristics)) {
    const k = JSON.stringify(e);
    if (!seen.has(k)) { seen.add(k); out.push(e); }
  }
  return out;
}

/** Repeatability of a triggered CONSUMER: a bare self-ETB (trigger names neither a type nor a
 *  subtype — "when this enters") is only satisfied by its own single entry, so it is one-time; any
 *  typed/subtyped trigger fires each time such a permanent recurs, so it is a repeatable engine. */
function triggerRepeatability(subject: SubjectFilter): "triggered" | "oneshot" {
  const bare = list(subject.type).length === 0 && list(subject.subtype).length === 0;
  return bare ? "oneshot" : "triggered";
}

/** Directional reasons from producer P to consumer C: event edges (P.emits ↔ C.triggers) and
 *  static edges (P.static effect ↔ C.characteristics). */
function directedReasons(p: DeckCard, c: DeckCard, h: Hierarchy): Reason[] {
  if (!p.tags || !c.tags) return [];
  const reasons: Reason[] = [];
  // Event edges.
  for (const e of producerEvents(p.tags)) {
    for (const a of c.tags.abilities) {
      if (!a.trigger) continue;
      if (!a.trigger.verbs.includes(e.verb)) continue;
      if (!subjectMatches(e.subject, a.trigger.subject, h)) continue;
      const key = `${e.verb}:${themeSubjectKey(a.trigger.subject)}`;
      reasons.push({
        tag: key,
        text: `${p.card.name} ${e.verb} feeds ${c.card.name}'s ${key} trigger`,
        effectKind: a.effect.kind,
        repeatability: triggerRepeatability(a.trigger.subject),
        scaling: a.effect.scaling,
      });
    }
  }
  // Static edges: P is a lord whose effect subject C's characteristics satisfy.
  for (const a of p.tags.abilities) {
    if (a.kind !== "static" || !a.effect.subject) continue;
    if (!subjectMatches(characteristicsSubject(c.tags), a.effect.subject, h)) continue;
    reasons.push({
      tag: `static:${a.effect.kind}`,
      text: `${p.card.name} ${a.effect.kind} applies to ${c.card.name}`,
      effectKind: a.effect.kind,
      repeatability: "static",
      scaling: a.effect.scaling,
    });
  }
  return reasons;
}

/** All reasons for the unordered pair {a,b}: union of a→b and b→a directional reasons. */
export function pairReasons(a: DeckCard, b: DeckCard, h: Hierarchy): Reason[] {
  return [...directedReasons(a, b, h), ...directedReasons(b, a, h)];
}
