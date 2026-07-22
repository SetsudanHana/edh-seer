import type { Reason } from "@mtg/engine";
import type { CardTags, GameEvent, SubjectFilter } from "@mtg/tagger";
import type { DeckCard, Hierarchy } from "./types.js";
import { subjectMatches, graveyardFillMatches, counterAddMatches } from "./subject.js";
import { impliedEvents, impliedGraveyardEvents, impliedCounterEvents } from "./implied.js";
import { normalizeZoneEvent, zoneEventKey } from "./zones.js";

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

/** A producer card's canonical events: authored emits + self-implied cast/enters, all zone-
 *  normalized and deduped, then unioned with the graveyard-fill events those emits imply. */
function producerEvents(tags: CardTags): GameEvent[] {
  const base = [
    ...tags.abilities.flatMap((a) => a.emits ?? []),
    ...impliedEvents(tags.characteristics),
  ].map(normalizeZoneEvent);
  const derived = [...impliedGraveyardEvents(base), ...impliedCounterEvents(base)];
  const withDerived = [...base, ...derived];
  const seen = new Set<string>();
  const out: GameEvent[] = [];
  for (const e of withDerived) {
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
  const pEvents = producerEvents(p.tags);

  // Event edges: normalized producer event ↔ normalized consumer trigger.
  for (const e of pEvents) {
    for (const a of c.tags.abilities) {
      if (!a.trigger) continue;
      for (const rawVerb of a.trigger.verbs) {
        const t = normalizeZoneEvent({ verb: rawVerb, subject: a.trigger.subject });
        if (t.verb !== e.verb) continue;
        const isGraveyardEntry = e.verb === "enters" && e.subject.zone === "graveyard";
        const matched = isGraveyardEntry
          ? graveyardFillMatches(e.subject, t.subject, h)
          : e.verb === "counter-added"
            ? counterAddMatches(e.subject, t.subject, h)
            : subjectMatches(e.subject, t.subject, h);
        if (!matched) continue;
        const key = zoneEventKey(t.verb, t.subject.zone, themeSubjectKey(t.subject));
        reasons.push({
          tag: key,
          text: `${p.card.name} ${key} feeds ${c.card.name}`,
          effectKind: a.effect.kind,
          repeatability: triggerRepeatability(t.subject),
          scaling: a.effect.scaling,
        });
      }
    }
  }

  // Reanimator-consumer edge: a producer graveyard fill enables C's graveyard-recursion effect.
  for (const e of pEvents) {
    if (!(e.verb === "enters" && e.subject.zone === "graveyard")) continue;
    for (const a of c.tags.abilities) {
      if (a.effect.kind !== "graveyard-recursion" || a.effect.subject?.zone !== "graveyard") continue;
      // Skip if the event-edge loop already credited this fill via a graveyard-entry trigger on the same ability.
      if (a.trigger && a.trigger.verbs.some((v) => {
        const t = normalizeZoneEvent({ verb: v, subject: a.trigger!.subject });
        return t.verb === "enters" && t.subject.zone === "graveyard" && graveyardFillMatches(e.subject, t.subject, h);
      })) continue;
      if (!graveyardFillMatches(e.subject, a.effect.subject, h)) continue;
      const repeatability =
        a.kind === "static" ? "static" : a.kind === "activated" ? "activated" : a.kind === "on-cast" ? "oneshot" : "triggered";
      reasons.push({
        tag: `graveyard-recursion:${themeSubjectKey(a.effect.subject)}`,
        text: `${p.card.name} fills the graveyard, enabling ${c.card.name}'s recursion`,
        effectKind: a.effect.kind,
        repeatability,
        scaling: a.effect.scaling,
      });
    }
  }

  // Static edges: P is a lord whose effect subject C's characteristics satisfy. (UNCHANGED)
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

/** All reasons for the unordered pair {a,b}: union of a→b and b→a directional reasons, deduped
 *  by byte-identical shape (e.g. an authored counter-added emit and a proliferate-derived
 *  counter-added emit can independently satisfy the same consumer trigger, producing two
 *  Reason objects with identical fields — collapse those since they carry no extra information). */
export function pairReasons(a: DeckCard, b: DeckCard, h: Hierarchy): Reason[] {
  const all = [...directedReasons(a, b, h), ...directedReasons(b, a, h)];
  const seen = new Set<string>();
  const out: Reason[] = [];
  for (const r of all) {
    const k = JSON.stringify(r);
    if (!seen.has(k)) { seen.add(k); out.push(r); }
  }
  return out;
}
