import type { SubjectFilter } from "../schema.js";

/** WHOSE ABILITY A TRIGGERED COPIER COPIES (#1648), read off its trigger's subject: "Whenever you activate an ability of an artifact" (Kurkesh), "a loyalty ability of
 *  a Chandra planeswalker" (Chandra's Regulator), "an ability of equipped creature" (the Bracers), "of enchanted planeswalker" (Rowan's Talent). The effect's own object is the pronoun
 *  "that ability", so the source lives only here. A targeted copier ("copy target ability you control from an artifact source") carries its `abilityOf` on the effect subject already.
 *
 *  A HOST (`equipped` / `enchanted`) is the status of the source creature or permanent, which the filter grammar refuses in an ability's source on purpose (every other card that
 *  says it, Imprison and Wizard's Staff, keeps its old reading); it is read here, for the copy family only, so no other card's derived subject moves.
 *  The tail "that isn't a mana ability" is a statement about the KIND, which `abilityKind` carries, and is cut before the source is read (Ashnod the Uncaring).
 *  CEILING: a source phrase the grammar does not read, or a property of the ABILITY rather than its source ("that targets a creature or player" -- Ertha Jo, Radiant Performer, Agrus Kos; "a backup
 *  ability", "if life was paid", "with {X} in its cost"), stays unrestricted: no producer states what its abilities target or cost, so nothing here can be checked. */
const HOST = /^(?:an? )?(?:(?:activated|triggered|loyalty) )?abilit(?:y|ies) (?:of|from) (equipped|enchanted) ([a-z]+)$/i;
const NOT_MANA_TAIL = / that isn'?t a mana ability$/i;

export function copySourceOf(
  triggerSubject: string | undefined,
  parseFilter: (text: string) => SubjectFilter | null,
): Partial<SubjectFilter> | undefined {
  if (triggerSubject === undefined) return undefined;
  const text = triggerSubject.trim().replace(NOT_MANA_TAIL, "");
  const host = HOST.exec(text);
  if (host) {
    // The grammar reads a bare "equipped creature" as a reference and returns null; its noun alone is a class ("a creature") it does read.
    const noun = parseFilter(`a ${host[2]!}`);
    if (noun === null || (noun.type === undefined && noun.subtype === undefined)) return undefined;
    const { token: _t, scope: _s, ...of } = noun;
    return { ...of, status: [host[1]!.toLowerCase()] };
  }
  const of = parseFilter(text)?.abilityOf;
  return of && Object.keys(of).length > 0 ? of : undefined;
}

/** WHAT THE COPIED ABILITY TARGETS (#1648), read from the sentence that names the ability: "an ability that targets a creature or player" (Ertha Jo), "target spell or ability that targets only a single
 *  permanent or player" (Radiant Performer), "an ability that targets only Agrus Kos" (Agrus Kos), "or activate an ability that targets only Bill Potts" (Bill Potts). `targets` is the filter grammar's own reading
 *  of the class ("that targets X", which also reads the card's name as `self`); `targetsOnly` is the word the grammar eats ("only"), which says the ability has no other target (CR 115.1). The LAST
 *  "ability that targets" in the text is the one read: Bill Potts names a spell before it and the spell half is not an ability.
 *  CEILING: "a spell ... that targets only X" is the spell half of the same sentence and is not read here; a copier whose object is a spell never meets this pass. */
const ABILITY_TARGETS = /\babilit(?:y|ies) that targets? (only )?([^,.;]+)$/i;

export interface CopyTargets { targets: Partial<SubjectFilter>; targetsOnly?: true }

export function copyTargetsOf(
  text: string | undefined,
  cardName: string | undefined,
  parseFilter: (text: string) => SubjectFilter | null,
  selfAsTilde: (text: string, name: string) => string,
): CopyTargets | undefined {
  if (text === undefined) return undefined;
  const m = ABILITY_TARGETS.exec(text.trim());
  if (!m) return undefined;
  const phrase = `an ability that targets ${m[1] ?? ""}${m[2]!}`;
  const read = parseFilter(cardName ? selfAsTilde(phrase, cardName) : phrase)?.targets;
  if (!read || Object.keys(read).length === 0) return undefined;
  return { targets: read, ...(m[1] ? { targetsOnly: true as const } : {}) };
}

/** A KEYWORD ABILITY THE COPIER NAMES (#1648): "becomes the target of a backup ability" (Mirror-Shield Hoplite; the clause record keeps only the subject "a creature you control"), "activate an exhaust
 *  ability". The keyword is the ability's (CR 702), so the producer is a card that PRINTS it. The filter grammar reads "a backup ability" as `keyword: ["backup"]` and files every keyword ability as activated,
 *  which is right for exhaust, ninjutsu, boast and wrong for backup: "Backup is a triggered ability" (CR 702.165a), so the kind is corrected.
 *  CEILING: only the keywords whose kind differs from the grammar's activated default are listed (backup); the other triggered keyword abilities (CR 702: extort, prowess, ...) are not a thing a copier names today. */
const NAMED_KEYWORD_ABILITY = /\b(?:of|activates?|activated) (an? [a-z]+ abilit(?:y|ies))\b/i;
const KEYWORD_ABILITY_KIND: Readonly<Record<string, "triggered">> = { backup: "triggered" };

export function copyKeywordOf(
  clauseText: string | undefined,
  parseFilter: (text: string) => SubjectFilter | null,
): { keyword: string[]; abilityKind: NonNullable<SubjectFilter["abilityKind"]> } | undefined {
  const m = clauseText === undefined ? null : NAMED_KEYWORD_ABILITY.exec(clauseText.split(",")[0]!);
  if (!m) return undefined;
  const f = parseFilter(m[1]!);
  if (!f?.keyword?.length || !f.abilityKind?.length) return undefined;
  const kind = KEYWORD_ABILITY_KIND[f.keyword[0]!];
  return { keyword: f.keyword, abilityKind: kind ? [kind] : f.abilityKind };
}

/** WHAT AN ABILITY AIMS AT, the producer side of `copyTargetsOf` (#1648): the target classes the clause's text names. See `Ability.targets`. The recipient of a grant, a pump or a "can't be countered"
 *  is in the sentence and not in the action's object ("Target creature you control gains protection", Mother of Runes), so the clause text is read for "target <class>" and "any target".
 *  A phrase of a relative clause ("each creature target player controls", "that targets") is skipped: it aims at a player and says a creature. */
const NOUN = "(?:creatures?|artifacts?|enchantments?|lands?|planeswalkers?|permanents?|players?|opponents?|spells?|abilit(?:y|ies)|cards?|battles?|tokens?)";
const TARGET_PHRASE = new RegExp(`(?<![\\w'-])(?:any (?:other )?target|target (?!of\\b)(?:[a-z'-]+ ){0,3}?${NOUN}(?: cards?)?(?: or (?:[a-z'-]+ )?${NOUN}(?: cards?)?)*(?:(?: with [a-z]+)?(?: (?:you|an opponent|your opponents|target opponent|that player|they|you don't|an opponent doesn't|opponents|defending player|the defending player) (?:control|controls|own|owns))?))(?![\\w-])`, "gi");
const PLAYER_ONLY = /^target (?:other |opposing )?(?:players?|opponents?)$/i;

export function targetSlotsOf(
  texts: readonly (string | null | undefined)[],
  cardName: string | undefined,
  parseFilter: (text: string) => SubjectFilter | null,
  selfAsTilde: (text: string, name: string) => string,
): Partial<SubjectFilter>[] | undefined {
  const slots: Partial<SubjectFilter>[] = [];
  for (const raw of texts) {
    const text = (raw ?? "").trim();
    for (const m of text.matchAll(TARGET_PHRASE)) {
      const before = text.slice(0, m.index).trimEnd();
      if (/\b(?:that|which|who) (?:targets?|could target|can target)$|\b(?:each|all|every|those|these|the)(?: other)? [a-z-]+s?$/i.test(before)) continue;
      const slot: Partial<SubjectFilter> = {};
      if (PLAYER_ONLY.test(m[0])) slot.player = true;
      else if (!/^any\b/i.test(m[0])) {
        const f = parseFilter(cardName ? selfAsTilde(`a ${m[0].slice(7)}`, cardName) : `a ${m[0].slice(7)}`);
        if (f?.type !== undefined) slot.type = f.type;
        if (f?.subtype !== undefined) slot.subtype = f.subtype;
        if (f?.anyOf !== undefined) slot.anyOf = f.anyOf;
        if (f && f.control !== "any") slot.control = f.control;
      }
      // WHOSE: "an opponent controls" / "you don't control" is an opponent's, "you control" is yours. A player slot is the opponent when it says so.
      if (/\b(?:an opponent|your opponents|target opponent|that player|they|opponents|defending player|the defending player) (?:control|controls|own|owns)\b|\byou don't (?:control|own)\b|^target (?:other |opposing )?opponents?$/i.test(m[0])) slot.control = "opp";
      else if (/\byou (?:control|own)\b/i.test(m[0])) slot.control = "you";
      // A CARD (in a graveyard, in exile) is not a permanent: its slot is the type `card`, whatever the words before it say ("target creature card").
      if (/\bcards?(?= (?:with|you|an|your|that|they|defending|the)\b|$)/i.test(m[0])) { delete slot.type; delete slot.subtype; delete slot.anyOf; slot.type = "card"; }
      // "two target lands", "three target creatures": that many targets (CR 115.1). "Up to two" can be one, and counts once.
      const count = /(?<!up to )\b(two|three|four|five)$/i.exec(text.slice(0, m.index).trimEnd())?.[1]?.toLowerCase();
      const n = count === undefined ? 1 : ({ two: 2, three: 3, four: 4, five: 5 } as Record<string, number>)[count]!;
      for (let k = 0; k < n; k++) slots.push(slot);
    }
  }
  return slots.length > 0 ? slots : undefined;
}
