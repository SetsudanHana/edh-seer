/** THE DIFFERENTIAL HARNESS for the card grammar (#896, task 1): any parser against `parseSubject` over
 *  the phrase census (`packages/tagger/phrases.jsonl`). Pure; `phrase-diff.ts` is the CLI.
 *
 *  A candidate returns `null` for a phrase it cannot parse COMPLETELY -- that phrase falls back to
 *  today's path, so it counts against coverage (S1) and never as a disagreement.
 *
 *  DISAGREEMENTS ARE GROUPED BY WHICH FIELDS DIFFER (H3). Labelling thousands of phrases one at a time
 *  is not a triage anyone finishes; a group ("type" differs, "control" differs) is labelled once and
 *  its members spot-checked.
 *
 *  Two readings are the SAME filter, not a disagreement: a lone string and a one-element array
 *  (`type: "creature"` vs `["creature"]`), and an OR-list in another order. Nothing else is folded:
 *  an absent field and `null` stay different, because `token: null` is a statement. */
import type { SubjectFilter } from "@edh-seer/tagger/schema";
import { counterKindOf } from "@edh-seer/tagger/subject";
import { KEYWORD_ABILITIES, SUBTYPES } from "@edh-seer/tagger/subtypes";

export interface Phrase { kind: "subject" | "object"; phrase: string; cards: number }
export type Parser = (text: string) => SubjectFilter | null;
export interface Example { kind: Phrase["kind"]; phrase: string; cards: number; baseline: SubjectFilter; candidate: SubjectFilter }
export interface Group { fields: string[]; distinct: number; cards: number; examples: Example[] }
export interface Tally { distinct: number; cards: number }
export interface PhraseDiff {
  total: Tally;
  /** Total and parsed per `domainOf` bucket: S1 over the filter language is the `filter` row. */
  byDomain: Record<string, { total: Tally; parsed: Tally }>;
  /** Phrases the candidate parsed completely (S1). */
  parsed: Tally;
  /** ...of which it agrees with the baseline on every field. */
  agree: Tally;
  /** H2: the candidate gave the same answer twice on every phrase. */
  nondeterministic: string[];
  groups: Group[];
}

const EXAMPLES = 20;

/** JSON with object keys sorted at every depth: `anyOf` holds filters, and two parsers need not build
 *  their keys in the same order (review). */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

/** One field's value in a comparable form. */
function canon(v: unknown): string {
  if (v === undefined) return "undefined";
  const list = typeof v === "string" ? [v] : Array.isArray(v) ? v : undefined;
  return list ? JSON.stringify(list.map(stable).sort()) : stable(v);
}

/** The fields on which two filters differ, sorted. */
export function differingFields(a: object, b: object): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => canon((a as Record<string, unknown>)[k]) !== canon((b as Record<string, unknown>)[k])).sort();
}

export function diffParsers(phrases: Phrase[], candidate: Parser, baseline: Parser): PhraseDiff {
  const byDomain: PhraseDiff["byDomain"] = {};
  const total = { distinct: 0, cards: 0 }, parsed = { distinct: 0, cards: 0 }, agree = { distinct: 0, cards: 0 };
  const nondeterministic: string[] = [];
  const groups = new Map<string, Group>();
  for (const p of phrases) {
    total.distinct++; total.cards += p.cards;
    const cand = candidate(p.phrase);
    if (JSON.stringify(cand) !== JSON.stringify(candidate(p.phrase))) nondeterministic.push(p.phrase);
    const dom = byDomain[domainOf(p.phrase)] ??= { total: { distinct: 0, cards: 0 }, parsed: { distinct: 0, cards: 0 } };
    dom.total.distinct++; dom.total.cards += p.cards;
    if (cand === null) continue;
    dom.parsed.distinct++; dom.parsed.cards += p.cards;
    parsed.distinct++; parsed.cards += p.cards;
    const base = baseline(p.phrase) ?? {} as SubjectFilter;
    const fields = differingFields(base, cand);
    if (fields.length === 0) { agree.distinct++; agree.cards += p.cards; continue; }
    const key = fields.join(",");
    const g = groups.get(key) ?? groups.set(key, { fields, distinct: 0, cards: 0, examples: [] }).get(key)!;
    g.distinct++; g.cards += p.cards;
    g.examples.push({ kind: p.kind, phrase: p.phrase, cards: p.cards, baseline: base, candidate: cand });
  }
  const sorted = [...groups.values()].sort((a, b) => b.cards - a.cards || a.fields.join().localeCompare(b.fields.join()));
  for (const g of sorted) {
    g.examples.sort((a, b) => b.cards - a.cards || a.phrase.localeCompare(b.phrase));
    g.examples = g.examples.slice(0, EXAMPLES);
  }
  return { total, byDomain, parsed, agree, nondeterministic, groups: sorted };
}

export function readPhrases(jsonl: string): Phrase[] {
  return jsonl.split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as Phrase);
}

/** WHICH LANGUAGE A PHRASE IS IN, so coverage of the FILTER language is measured over filter
 *  phrases. The census holds every trigger subject and action object, and most of it is not a noun
 *  phrase for a filter at all: "Flying" (a keyword granted), "+1/+1" (a counter kind), "{C}" (mana),
 *  "this creature" (a reference, task 4), "chapter II" (a time, task 5), "be blocked" (a verb).
 *
 *  Decided HERE, by a few explicit rules on the first words, and never by the parser under test: a
 *  grammar that marked what it cannot read as out of its domain would grade itself. Everything no
 *  rule claims is `filter`, so a rule too narrow LOWERS the measured coverage rather than raising it. */
const KEYWORD_LISTS = KEYWORD_ABILITIES.map((k) => k.split(" "));
const REFERENCE_WORDS = new Set(["this", "that", "those", "these", "it", "its", "them", "they", "itself", "enchanted", "equipped", "the", "he", "she", "him", "her"]);
const VERB_WORDS = new Set(["be", "block", "attack", "untap", "not", "pay", "sacrifice", "exert", "discard", "exile", "draw", "deal", "deals", "tap", "gain", "lose", "return", "put", "cast", "create", "destroy", "transform", "search", "reveal", "look", "mill", "scry", "copy", "choose", "do", "remove", "counter", "become", "becomes", "play", "attacks", "blocks", "dies", "enters", "leaves", "change", "control", "assign", "assigns", "skip", "investigate", "open", "regenerate", "end", "activate",
  "venture", "draft", "note", "prevent", "planeswalk", "explore", "earthbend", "cycle", "collect", "avoid", "add", "unlock", "lock",
  "repeat", "reselect", "ignore", "secretly", "begin", "phase", "distribute", "circle", "attach", "fly", "flies", "doesn't", "don't",
  "cause", "enter", "visit", "bands", "proliferate", "populate", "connive", "surveil", "manifest", "amass", "adapt", "bolster",
  "support", "fateseal", "incubate", "discover", "forage", "suspect", "goad", "detain", "exert", "monstrosity", "learn", "seek",
  "conjure", "perpetually", "roll", "flip", "vote", "shuffle", "win", "lose", "double", "triple", "switch", "exchange", "reveal", "plotting", "go", "use", "guess", "reorder", "reverse"]);
/** A TIME: the phrase IS a turn, phase, step, chapter, day or night ("your upkeep", "the next end
 *  step", "an additional combat phase", "chapter II"). Anchored at the start: a filter that merely
 *  mentions a turn ("a creature that entered THIS TURN") is a filter, and a clause that ends "until
 *  end of turn" is caught as a clause by its verb. */
const TIME = /^(?:chapter\b|(?:i|ii|iii|iv|v|vi)(?:,|$| or )|at the beginning of\b|each of (?:your|their) \w+ (?:main phases|turns|upkeeps)\b|when(?:ever)? you\b|if it's the (?:first|second|last)\b|day\b|night\b|(?:(?:your|each|the|their|that player's|an opponent's|each opponent's|each player's|target opponent's|target player's|this|that)\s+)?(?:(?:next|first|second|last|extra|additional|precombat|postcombat)\s+)*(?:turns?|upkeeps?|end steps?|main phases?|combat(?: phases?| steps?| damage steps?)?|draw steps?|untap steps?|beginning(?: phases?)?|cleanup steps?)\b|(?:an?|one|two|x)\s+(?:(?:extra|additional|precombat|postcombat)\s+)*(?:turns?|upkeeps?|end steps?|main phases?|combat(?: phases?)?|beginning phases?)\b)/;
/** AN AMOUNT, not a class: "1 damage", "X times", "half your life", "equal to its power", "life".
 *  Task 6's magnitudes. */
const AMOUNT = /^(?:(?:\d+|x|one|two|three|half|twice)\s+(?:damage|life|times)\b|(?:damage|life|half|twice|equal to)\b|x,?\s+where\b|all (?:(?:non)?combat )?damage\b|all but \d|(?:non)?combat damage\b|\d+ for each\b|excess damage\b|base (?:power|toughness)\b|energy equal\b|an amount\b|a number of times\b|an additional time\b|(?:any number of )?players' life totals$|once for each\b|\d+, divided\b)/;
/** "your second spell", "their first card": the Nth event of a turn, a trigger condition (task 5). */
const ORDINAL = /^(?:your|their|an opponent's|each player's|a player's)\s+(?:first|second|third|fourth|fifth|next)\b|\byou next cast\b|\bfor the first time each turn$/;
/** A player doing something: "you discard a card", "you cast a noncreature spell" -- a clause. */
const PLAYER_CLAUSE = /^(?:you and an opponent each|you|you've|players?|an opponent|each player|each opponent|target player|target opponent|a player)\s+(?:controls|tap|visit|open|waterbend|was|were|been|gained|lost|skip|skips|place|fully|expend|decide|cycled|chose|remove|return|put|rolling|rolls|sacrifices|scries|owns?|giving|gaining|cast|discard|exile|sacrifice|search|reveal|note|choose|lose|gain|draw|mill|create|attack|block|roll|flip|play|activate|control|don't|do|have|has)\b/;
/** A type-setting or rules-bending effect's object: "a Vampire in addition to its other types",
 *  "Angel creature type", "creature spells as though they had flash". */
const EFFECT_OBJECT = /\bin addition to (?:its|their) other\b|(?<!chosen )\b(?:creature )?type$|\bas though\b/;
/** A row of a die-roll table: "10—19", "1—9 | ...". */
const TABLE_ROW = /^\d+\s*[—–-]\s*\d+/;
/** Game pieces a verb acts on, not cards: "flip a coin", "roll a d20", "put a sticker on it". */
const GAME_PIECE = /^(?:a|an|one or more|one|two|three|four|five|six|\d+|x|up to \w+)?\s*(?:coins?|d\d+|(?:four|six|twenty)-sided (?:die|dice)|dice|die|(?:name |art |ability )?stickers?|emblems?\b|dungeons?|(?:an )?attractions?|piles?\b|booster packs?|planar (?:die|dice|deck)|power and toughness stickers?)\b|\bplanar deck\b|^(?:you |to )?(?:open|visit) (?:an |your )?attractions?\b/;
/** A FRAGMENT that names nothing on its own: "your", "any", "each", "both creatures" is a count. */
const FRAGMENT = /^(?:your|their|its|any|each|one|the rest|all|this|that|both|either)$/;
/** A BARE CARD NAME ("Acererak", "Arachnus Web", "Xantcha's power"): a specific other card, which a
 *  filter does not describe. Every word capitalized (lowercase joiners allowed) and none a type or a
 *  subtype, so "Elves" or "Goblins you control" are never names. Read on the phrase as printed. */
function isBareName(phrase: string): boolean {
  const words = phrase.trim().split(/\s+/);
  if (words.length === 0 || words.length > 6 || !/^\p{Lu}/u.test(words[0]!)) return false;
  const joiners = new Set(["of", "the", "and", "or", "to", "a", "in", "for", "power", "toughness"]);
  return words.every((w) => /^\p{Lu}[\p{L}\d'’,-]*$/u.test(w) || joiners.has(w))
    && !words.some((w) => {
      const l = w.toLowerCase().replace(/[,'’]s?$/, "");
      return SUBTYPES.has(l) || SUBTYPES.has(l.replace(/s$/, "")) || /^(?:creatures?|artifacts?|enchantments?|lands?|planeswalkers?|spells?|cards?|permanents?|tokens?|instants?|sorcer(?:y|ies)|battles?|you|your|each|all|other|another|target)$/.test(l);
    });
}
/** A SHORT PHRASE WITH NO FILTER WORD IN IT: one word, or two joined by "or", none of them a type,
 *  subtype, colour, player, status or P/T -- a vote ("carnage or homage"), a keyword action ("loot"),
 *  a counter kind ("bore"), a participle ("sacrificed"). Every such phrase that IS a filter ("Angel",
 *  "blue", "opponent", "tapped", "10/10") carries one of those words. */
const FILTER_WORD = /^(?:(?:non-?)?(?:sources?|creatures?|artifacts?|enchantments?|lands?|planeswalkers?|spells?|cards?|permanents?|tokens?|instants?|sorcer(?:y|ies)|battles?|abilities|ability|kindred|tribal|legendary|basic|snow|white|blue|black|red|green|colou?rless|multicolou?red|monocolou?red|you|players?|opponents?|target|attacking|blocking|blocked|unblocked|tapped|untapped|suspected|goaded|face-(?:up|down)|enchanted|equipped|historic|outlaws?)|[+-]?(?:\d+|x|\*)\/[+-]?(?:\d+|x|\*))$/;
function isNoFilterWord(text: string): boolean {
  // "a crime", "each foe": an article or "each" adds no filter word.
  const words = text.replace(/^(?:an?|each) /, "").split(/\s+or\s+|\s+/);
  if (words.length > 2 || (words.length === 2 && !/\sor\s/.test(text))) return false;
  return words.every((w) => !FILTER_WORD.test(w) && !SUBTYPES.has(w) && !SUBTYPES.has(w.replace(/s$/, "")) && !SUBTYPES.has(w.replace(/(?:es|ves)$/, "")));
}
/** Energy written as letters: "E E E", "eight {E}". */
const ENERGY = /^(?:(?:e\s*)+|\w+ \{e\})$/;
/** A counter as the object: "a counter", "a +1/+1 counter on this creature", "two +1/+1 counters". */
const COUNTER_OBJECT = /^(?:a|an|one or more|one|two|three|four|five|six|seven|eight|nine|ten|x|\d+|all|up to \w+)(?: or more)?\s+(?:[+-]\S+\s+|[a-z-]+\s+)?counters?\b/;
const ZONE = /^(?:(?:your|their|its owner's|target player's|target opponent's|an opponent's|each opponent's|all opponents'|each player's|that player's|a player's|all|each)\s+)?(?:library|libraries|hand|hands|graveyard|graveyards|life total)\b/;
/** A CLAUSE, not a noun phrase: a finite verb the subject does ("target creature GAINS trample",
 *  "you PAY {1}", "you HAVE no maximum hand size"). Task 6's actions. A verb inside a relative clause
 *  ("a creature THAT HAS flying") is still a noun phrase, so a relative pronoun before the verb keeps
 *  the phrase in `filter`. "cast"/"casts" are absent on purpose: "spells you cast" is a filter. */
const CLAUSE_VERB = /\b(?:gains?|gets?|loses?|can't|can|becomes?|has|have|is|are|deals?|may|would|pays?|attacks|blocks|enters|dies|wins?|draws?|untaps?|costs?|causes?|plays?|attack|block|assigns?|chooses|commits|claim|attach|be|gained|lost|fights|was|were|left (?:the|your|its)|ensues|applies|enter|equals)\b/;
const RELATIVE = /\b(?:that|that's|who|which|whose)\b/;
/** A REFERENCE inside a longer phrase: what was exiled, revealed or chosen earlier, "those", "that
 *  many". Task 4 and #900's population, resolved by `derive/references.ts`, not by a filter. */
const INNER_REFERENCE = /^chosen\b|^an? chosen\b|\b(?:you|your opponent|they) chose\b|^(?:a |an |up to \w+ |two of the )?(?:revealed|returned)\b|\bnoted\b|\bpiles?\b|\bsector\b|\bthe same way\b|\bthey find\b|\bstored results\b|^his\b|\bamong them$|\bcopy of the chosen card\b|\b(?:weren't|were) chosen\b|\bother than \w+ chosen\b|^a target of\b|(?<!name )\bchosen for\b|^(?:new )?targets for\b|\bfound in\b|\bused to craft\b|(?<!cop(?:y|ies) )\bof (?:enchanted|equipped) \w+$|(?<!cop(?:y|ies) )\bof the (?:exiled|chosen|last chosen) (?:cards?|permanent)\b|\bthe most votes\b|\b(?:not |other than (?:up to \w+ |one |the )?)chosen\b|\bnot in a chosen\b|\bits controller (?:controls|'s)\b|\bit (?:blocked|was blocking)\b|\bof that colou?r\b|\bfrom (?:it|them|that (?:hand|source's|player's)|the (?:chosen|other) pile|the pile of|its controller's|chosen)\b|\b(?:attached to (?:it|them|that \w+)|blocking (?:it|them)|blocked by it|it's blocking|this way|exiled with|from among|of them|of those|those|they (?:control|own|don't)|that (?:card|creature|player|spell|permanent|ability|many|much|token|land|artifact|opponent))\b/;

export function domainOf(phrase: string): string {
  // "~" is the card's own name: a self-reference, except where it is what a filter names -- after
  // "named" ("a card named ~") or as what a spell targets ("a spell that targets ~").
  // A NAMED TOKEN ("The Blackjack, a legendary 3/3 ... token", "~ Twin, a legendary ... token") is
  // a token, whatever its name says.
  const appositionToken = /^[^,]+, an? [^"]*\btokens?\b/i.test(phrase);
  const amountless = phrase.split(/["“]|\bwhere\b|\bequal to\b|\bless than\b|\bgreater than\b|\bfor each\b/)[0]!;
  if (!appositionToken && amountless.replace(/\bnamed .*$/, "").replace(/\btargets? .*~/, "").replace(/\bby ~/g, "").includes("~")) return "reference";
  const text = phrase.toLowerCase().replace(/’/g, "'").trim();
  // A DEFECT OF THE CLAUSE STORE, not English: two fields run together ("target Villain you
  // control|menace"), a die row cut off ("Orcs 2", "you 3"), "first strike" split in two ("target
  // creature's strike"). Explicit shapes only; each was read in the census.
  // Also a subject whose verb was dropped ("an opponent by a red instant or sorcery spell you control",
  // Chandra's Phoenix: "is dealt damage" is gone), and a token given its maker's ability word ("a 5/4 ...
  // Dragon Spirit creature token with Enrage", Vrondiss: the token's ability is a quoted trigger), and a
  // subtype the census rewrote as "~" because a card bears its name ("target ~ creature",
  // Assembly-Worker's "target Assembly-Worker creature"), and two clauses run together ("target card
  // from the top two cards of target opponent's chosen card from your graveyard", Phyrexian Grimoire:
  // "Target opponent chooses one of the top two cards of your graveyard").
  if (/\||^\w+ \d+$|^strike of\b|'s strike$|\bentering from causing\b|^an opponent by\b|\btoken with enrage$|^target ~ creature$|\btarget opponent's chosen card\b/.test(text)) return "malformed";
  if (text.startsWith("(")) return "reminder";
  if (text.startsWith('"') || text.startsWith("“")) return "quoted";
  // Ability text: a loyalty ability ("[+1]: ...") or "activated ability: ...".
  if (/^\[[^\]]*\]:|^(?:an? )?(?:activated|triggered) ability:|^activated ability\b/.test(text)) return "ability-text";
  // "each creature: Prevent the next 1 damage ...", 'with "Creatures you control ... get +3/+3."'.
  if (/^[^:"]{1,20}: \p{Lu}/u.test(phrase) || /^with ["“]/.test(text)) return "ability-text";
  // An ability paraphrased by the clause store ("an activated ability that taps this Saga for {C}",
  // Urza's Saga; "music counter ability", Musician).
  if (/^an activated ability that (?:costs|taps)\b|\bcounter ability$/.test(text)) return "ability-text";
  // A recipient with the ability it is granted: "planeswalkers you control [0]: proliferate", "lands
  // you control; {T}: add {G}", "creatures you control, abilities 1 and 2". Text, not a filter.
  if (/\]:|\}\s*:|\bability:|\babilities \d|; \w+ ability$|: [a-z]+ \{|^[+\-−]\{/.test(text.split(/["“]|\btoken\b/)[0]!)) return "ability-text";
  // A parenthesised note or a "Name — {1} — 5/2" row is no filter phrase.
  if (/[()]/.test(text) || /\s[—–]\s\{/.test(text)) return "reminder";
  // Split on the dash a keyword's cost hangs off ("Ward—Discard a card.") and on ";" too.
  const w = text.split(/[\s,—–;:]+/).filter((x) => x !== "");
  if (w.length === 0) return "empty";
  if (!appositionToken && (REFERENCE_WORDS.has(w[0]!) || (w[0] === "one" && w[1] === "of"))) return "reference";
  // "Enchant creature you control" names a CLASS after the keyword: a filter phrase, and one the
  // grammar does not read yet. Counting it as a keyword would hide 1,239 card-occurrences of misses
  // (review). Every other keyword line is a grant or a cost.
  if (w[0] !== "enchant" && KEYWORD_LISTS.some((ws) => ws.every((x, j) => w[j] === x))) return "keyword";
  // counterKindOf splits a comma list and takes its one kind, so a token "with flying, vigilance, and
  // indestructible" would read as an indestructible counter: only a comma-free phrase is asked.
  if (/^[+-](?:\d|x)/.test(w[0]!) || (!text.includes(",") && counterKindOf(text)) || (/\bcounters?$/.test(text) && counterKindOf(text.replace(/^(?:a|an|one or more|one|two|three|x|\d+|all)\s+/, "")))) return "counter";
  if (w.length === 1 && /^(?:\d+|x)$/.test(w[0]!)) return "number";
  if (TABLE_ROW.test(text)) return "table";
  // A die result: "a 3 or higher", "a natural 20", "a 6".
  if (/^an? (?:natural )?\d+(?: or (?:higher|lower|more|less))?$/.test(text)) return "game-piece";
  // A colour choice: "a color of your choice", "any color", "any one color", "any combination of colors".
  if (/^(?:a color|any (?:one )?colou?r|any combination of colou?rs|a colou?r of your choice)\b/.test(text)) return "mana";
  // "each kind of counter", "a third of their life".
  if (/^each (?:kind of )?counter\b|^each kind of counter\b|^a kind of counter\b/.test(text)) return "counter";
  // "a +1/+1, first strike, or trample counter": a choice of counter kinds.
  if (/^an? [^"]*, (?:or|and) [\w ]+ counter$/.test(text)) return "counter";
  if (/^(?:a third|half|a quarter) of\b/.test(text)) return "amount";
  // A count or an arithmetic amount: "for each land you control", "X plus 3", "any amount".
  if (/^for each\b|^x (?:plus|minus|of|if|\{)|^any amount\b|^one energy\b/.test(text)) return "amount";
  // Objects chosen or named earlier: "both creatures", "each of the chosen creatures".
  if (/^both (?:creatures|cards)\b|^each of (?:the chosen|its controller's)\b/.test(text)) return "reference";
  if (/^your starting deck\b|^each time vote\b|^for a player\b/.test(text)) return "clause";
  if (/^each (?:\w+ )?counter on\b|^any number of counters\b/.test(text)) return "counter";
  // A stat of a named object: "target creature's power and toughness" -- an amount.
  if (/'s (?:power|toughness|mana value|loyalty)(?: and toughness)?$/.test(text) && !/\b(?:with|where|than|equal|to)\b/.test(text)) return "amount";
  // Objects named by an earlier action: "searched cards", "revealed cards", "the copies".
  if (/^(?:searched|revealed|remaining|found|chosen|exiled|discarded|milled) cards?$|\bthe copies\b|^one onto\b|\bcards? found\b|\bcreated with (?:it|this \w+|~)\b/.test(text)) return "reference";
  // "... cost {2} more to cast": a cost change, a clause even after a relative clause.
  if (/\bcosts? (?:\{\w+\}|an additional\b|\d+\b).*\b(?:more|less|to cast|to activate)\b/.test(text.split(/["“]/)[0]!)) return "clause";
  if (/^(?:each player|players?) (?:hides|finish|passes)\b/.test(text)) return "clause";
  if (GAME_PIECE.test(text)) return "game-piece";
  if (FRAGMENT.test(text)) return "fragment";
  // "cards equal to the number of ...": how many, an amount.
  if (/^(?:\w+ )?cards?(?: from [\w' ]+?)? equal to\b/.test(text)) return "amount";
  // "cards from the top of your library until you reveal a creature card": a dig, the action's process.
  if (/\buntil (?:you|they|that player|an opponent|each player|its controller)\b/.test(text)) return "clause";
  if (ENERGY.test(text)) return "mana";
  if (/^after this (?:\w+ )?(?:one|phase|turn|step)\b/.test(text)) return "time";
  // A condition or a duration that opens the phrase: "if {C} was spent to cast it", "until end of turn, ...".
  if (/^(?:if|until|unless)\b/.test(text)) return "clause";
  // Evasion and its exceptions ("blocked by fewer than two creatures", "blocked except by Snow
  // creatures"), a condition on what follows ("two cards unless you discard a creature card"), and
  // a status for a duration ("saddled until end of turn").
  if (/^(?:blocked (?:by|except)|unblocked if able|saddled)\b|\bunless\b/.test(text.split(/["“]/)[0]!)) return "clause";
  // Types as what something becomes or counts: "Pirate type in addition to other types", "all creature
  // types", "four or more card types among cards in your graveyard".
  if (/\btype (?:until|and|in addition)\b|^all (?:creature|basic land) types$/.test(text)) return "clause";
  if (/\bcard types among\b/.test(text.split(/["“]/)[0]!)) return "amount";
  // A dig ("all but the bottom card of each opponent's library") or players' zones as the object.
  if (/^all but the bottom\b|^(?:any number of )?target players' (?:graveyards|hands|libraries)$/.test(text)) return "zone";
  if (/\bof dungeons\b|\bability stickers\b|^one result\b/.test(text)) return "game-piece";
  // A vote ("evidence vote", Tivit) and named vote choices ("Redhorn Pass or Mines of Moria", Travel
  // Through Caradhras).
  if (/^\w+ vote$/.test(text)) return "fragment";
  if (/^\p{Lu}\S* \p{Lu}\S*(?: (?:of|the) \p{Lu}\S*)* or \p{Lu}\S*(?: (?:of|the))? \p{Lu}\S*(?: (?:of|the) \p{Lu}\S*)*$/u.test(phrase)) return "name";
  // A MAIN VERB after a filter-shaped subject that a stat's amount hides from the head below:
  // "creatures with power less than this creature's power CAN'T BLOCK ...", "... ASSIGNS combat damage".
  if (/\b(?:can't (?:block|attack|be cast)|assigns? combat damage|stations permanents|are goaded|are no longer|gains? (?:\w+ ){1,3}until|isn't \w+ until|costs nothing|attack this turn$|an additional sacrifice|are colorless$|is created under)\b/.test(text.split(/["“]/)[0]!)) return "clause";
  // A stat or a total of a NAMED object: "Aetherwing's power equal to ...", "defending player's life total".
  if (!/\b(?:is|are|equals|switched)\b/.test(text) && /^(?!(?:target|each|all|an?|any|up|another|other|switch|exchange|double)\b)[^ ]+(?: [^ ]+){0,3}'s (?:base )?(?:power|toughness|life total|combat damage|counters|text box|stored results)\b/.test(text)
    || /^(?:target|each) [\w ]+'s (?:power and toughness|combat damage|life total)\b(?!.*\b(?:is|are|switched)\b)/.test(text)) return "amount";
  // The draft (Conspiracy), outside any game: "a creature card you drafted", "guess that the next player to draft".
  if (/\bdraft(?:ed|ing)?\b/.test(text)) return "draft";
  // A mode or a result chosen earlier: "Ghost mode chosen".
  if (/\bmode chosen$/.test(text)) return "reference";
  // A named card moved or pumped ("Arachnus Web to target creature", "Celeborn +1/+1 until end of
  // turn"): the card itself, a reference.
  {
    const m = /^(\p{Lu}[\p{L}'’ -]*?) (?:to target\b|[+-]\d+\/[+-]\d+)/u.exec(phrase);
    if (m && isBareName(m[1]!)) return "reference";
  }
  // A named card's controller ("Xantcha's controller"): the card itself, through a reference.
  if (/^\p{Lu}[\p{L}'’ -]*'s (?:controller|owner)$/u.test(phrase) && isBareName(phrase.replace(/'s (?:controller|owner)$/, ""))) return "reference";
  // "Beregond or another Human you control": the card's own name, then a class -- the self-or-class
  // twin (task 4), not one filter.
  if (/^\p{Lu}[\p{L}'’ -]*? or another\b/u.test(phrase) && !/^(?:target|each|all|an?|another)\b/.test(text) && isBareName(phrase.split(/ or another\b/)[0]!)) return "reference";
  if (COUNTER_OBJECT.test(text)) return "counter";
  if (AMOUNT.test(text)) return "amount";
  if (EFFECT_OBJECT.test(text.split(/["“]/)[0]!)) return "clause";
  if (w[0]!.startsWith("{") || /^(?:\d+|one|two|three|four|five|six|seven|eight|x) \{/.test(text) || /^(?:spent|unspent)\b/.test(text) || /\bmana\b(?! value| cost)/.test(amountless.toLowerCase())) return "mana";
  if (/^\w+ ?landwalk$/.test(text)) return "keyword";
  if (text === "your deck" || ZONE.test(text) || /^(?:(?:any number|each|one|two|three|up to \w+) of )?(?:the )?top (?:\w+ )?cards? of\b/.test(text)) return "zone";
  if (ORDINAL.test(text)) return "ordinal";
  if (PLAYER_CLAUSE.test(text)) return "clause";
  if (!text.includes(" named ") && TIME.test(text)) return "time";
  if (VERB_WORDS.has(w[0]!)) return "verb";
  if (isBareName(phrase)) return "name";
  // Only the HEAD is read: a verb or a reference inside a granted ability's quotes ('a Rat token with
  // "This token can't block."'), a count ("a card for each counter you have") or a stat's amount ("with
  // mana value less than that creature's") does not make the phrase a clause or a reference.
  const head = text.split(/["“]|\bfor each\b|\bwhere\b|\bequal to\b|\bthe number of\b|\bless than\b|\bgreater than\b|\bsame name as\b|\bshares? a\b|\bshares? no\b/)[0]!;
  // A token "with flying and THAT ABILITY" names its class in full; the ability it is granted is the
  // action's (as a quoted one is), not a reference the filter must resolve.
  if (INNER_REFERENCE.test(/\btokens?\b/.test(head) ? head.replace(/(?:,? and| with) that ability$/, "") : head)) return "reference";
  // A condition on a target ("target spell if it WAS kicked") is not the phrase's own verb.
  const main = head.split(/\bif\b/)[0]!;
  const verb = CLAUSE_VERB.exec(main);
  if (verb && !RELATIVE.test(main.slice(0, verb.index))) return "clause";
  // A counter kind named alone: "impostor counter", "loyalty counters on a planeswalker".
  if (/^(?:[+-]\S+|[a-z-]+) counters?(?: on\b|$)/.test(text)) return "counter";
  // A capitalised word after the article is a name ("a Jace"), never a fragment.
  if (isNoFilterWord(text) && !/^(?:an?|each) \p{Lu}/u.test(phrase)) return "fragment";
  // "a creature card name": a name to choose, not a card.
  if (/^an? [\w ]*card name$/.test(text)) return "name";
  return "filter";
}
