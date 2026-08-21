/** Mechanical clause segmentation of oracle text — no LLM.
 *
 *  The extraction experiment measured where nondeterminism actually lives: across two identical
 *  runs only 55% of cards produced the same STRUCTURE, while the corpus-wide verb set was
 *  byte-identical. The instability is segmentation — how many abilities the model splits a card
 *  into and how it groups them. So we take that decision away from it: split here, deterministically,
 *  and hand the model a numbered list of clauses it must fill in one-for-one.
 *
 *  This also gives a completeness check we have never had. A clause that produces no record is an
 *  error rather than silence, which is the class of bug that let Bitterblossom sit in the corpus
 *  with zero abilities, indistinguishable from a vanilla bear. */

export type ClauseKind =
  | "ability"        // ordinary rules text
  | "keyword"        // printed keywords only ("Flying, first strike", "Ward {2}")
  | "mode"           // one bullet of a modal ability
  | "chapter"        // Saga chapter ("I —", "II, III —")
  | "level"          // Class level marker ("{3}{W}: Level 2")
  | "modal"          // the line introducing modes ("Choose two —")
  | "granted"        // an ability granted in quotes ("... has \"{T}: Add {C}.\"")
  | "reminder";      // parenthetical reminder text only

export interface Clause {
  /** 1-based, stable within a card — the slot id the model must fill. */
  id: number;
  kind: ClauseKind;
  /** The clause text with reminder parentheses removed. */
  text: string;
  /** Ability-word or chapter/level marker stripped from the front, if any. */
  marker?: string;
  /** For a mode, the id of the clause introducing "choose one —". */
  parentId?: number;
  /** Derived here, not asked of the model: it disagreed with itself on 3 of 20 cards over a
   *  question with a mechanical answer (is Path to Exile's text a spell ability?). */
  abilityType?: "spell" | "activated" | "triggered" | "static";
  /** The clause fires on TWO different events ("enters or is put into a graveyard"). The schema
   *  holds one `trigger` per record, so such a clause is legitimately answered with two records —
   *  see `validate-clauses.ts`, which uses this to bound how many extra ids it will accept. */
  multiTrigger?: true;
  /** The activation cost, when the clause is "{cost}: effect". Split off so the model cannot
   *  choose between recording a sacrifice cost as prose or as an action — Phyrexian Tower's
   *  "{T}, Sacrifice a creature:" is what an aristocrats deck needs to see. */
  cost?: string;
  /** Actions the cost performs that another card can trigger on, derived from `cost`. */
  costActions?: string[];
  /** Actions the EFFECT states, derived mechanically from the text. Handed to the model so it
   *  cannot answer a clause with the `other` escape hatch that the vocabulary does cover. */
  effectActions?: string[];
}

/** True when the card itself is an instant or sorcery — its text is a spell ability by default. */
function isSpellCard(typeLine: string): boolean {
  return /\b(instant|sorcery)\b/i.test(typeLine);
}

/** Leading "{cost}: effect" or "Cost, Cost: effect" — an activated ability (CR 602). A cost part is
 *  a RUN of mana symbols ({U/R}{U/R}{U/R}) or a short phrase; Izzet Locket's four adjacent hybrid
 *  symbols defeated an earlier version that allowed only one brace group per part, so its cost was
 *  never split off and it was misfiled as a static ability.
 *
 *  A part is bounded by the SENTENCE, not by a character count. The old 40-character cap typed 583
 *  corpus cards static — Master Transmuter's "Return an artifact you control to its owner's hand" is
 *  49 — which lost the cost (the aristocrats signal) and gave each card the wildcard-lord shape that
 *  false-edge meshes are made of. The cap was also the only thing keeping a whole sentence out:
 *  excluding the period is a tighter bound than any number, because no cost part ever spans one. */
const ACTIVATED = /^((?:(?:\{[^}]*\})+|[^:{}.]{1,80}?)(?:\s*,\s*(?:(?:\{[^}]*\})+|[^:{}.]{1,80}?))*)\s*:\s+/;

/** Actions a cost performs that another card can trigger on. Extracted here rather than left to
 *  the model, which recorded a sacrifice cost on one run and dropped it the next. Paying mana and
 *  tapping the source are deliberately absent: nothing triggers on them. */
const COST_ACTIONS: [RegExp, string][] = [
  [/\bsacrific\w*\b/i, "sacrifice"],
  [/\bdiscard\w*\b/i, "discard"],
  [/\bexile\w*\b/i, "exile"],
  // "pay-life" is not a VERBS member (normalize-prompt.ts); paying life IS losing life, and
  // "lose-life" already exists and reaches life-loss payoffs, so alias it there instead of handing
  // the model a cost verb outside its closed vocabulary.
  [/\bpay \d+ life\b/i, "lose-life"],
  [/\bremove\b.*\bcounter/i, "remove-counter"],
  [/\breturn\w*\b/i, "return"],
];

/** Actions the EFFECT states, derived here rather than left to the model. `other` is the deliberate
 *  escape hatch for effects no verb covers, but measurement showed it leaking: it appears in 5 of 8
 *  planeswalker verb disagreements and swallows whole clauses (Plasma Caster came back
 *  `exile,deal-damage` on one run and a lone `other` on the next). Double-run reconciliation cannot
 *  catch that, because a clause the vocabulary genuinely cannot express returns `other` on BOTH
 *  runs and agrees with itself.
 *
 *  Only cues that survived a precision check against 180 cards of stored model output are listed;
 *  a wrong verb is consumed as if it were true, so a false positive costs more than the `other` it
 *  replaces. `bin/effect-precision.ts` re-runs that check for free. */
/** Number words as printed on cards, so "Draw seven cards" keeps its seven. Jace, Wielder of
 *  Mysteries came back as `draw(you)` with the amount dropped, and the seven is the whole card. */
const WORD_NUMBER: Record<string, string> = {
  a: "1", an: "1", one: "1", two: "2", three: "3", four: "4", five: "5",
  six: "6", seven: "7", eight: "8", nine: "9", ten: "10", x: "X",
};
const COUNT = "a|an|one|two|three|four|five|six|seven|eight|nine|ten|\\d+|X";

/** `[cue, verb, amountGroup?]` — the third element names the capture holding the amount. */
const EFFECT_ACTIONS: [RegExp, string, number?][] = [
  [new RegExp(`\\bdeals?\\s+(${COUNT})\\s+damage\\b`, "i"), "deal-damage", 1],
  [/\bgets?\s+[+\-−][\dX]+\/[+\-−][\dX]+/i, "modify-pt"],
  [/\bdestroy\b/i, "destroy"],
  [/\bcounters?\s+target\s+(?:spell|ability)/i, "counter-spell"],
  [new RegExp(`\\bdraws?\\s+(${COUNT})\\s+cards?\\b`, "i"), "draw", 1],
  [new RegExp(`\\bgains?\\s+(${COUNT})\\s+life\\b`, "i"), "gain-life", 1],
  [new RegExp(`\\bloses?\\s+(${COUNT})\\s+life\\b`, "i"), "lose-life", 1],
  [new RegExp(`\\bmills?\\s+(${COUNT})\\b`, "i"), "mill", 1],
  // An emblem is not a token, so it is not `create` — the vocabulary had no verb for it and the
  // model split between `create` and `other` across runs, which was the single largest source of
  // residual planeswalker drift once the rest of the table landed.
  [/\byou get an emblem\b/i, "emblem"],
  // Fight is mutual damage between two creatures. Without a verb it came back as `other`, so an
  // aristocrats or damage payoff could not see it at all.
  [/\bfights?\b/i, "fight"],
  // "Target opponent's life total becomes 10" (Sorin Markov) is not lose-life — the amount lost
  // depends on their current total — but it is not `other` either.
  [new RegExp(`\\blife total becomes\\s+(${COUNT})\\b`, "i"), "set-life", 1],
  // Proliferate is a keyword action with no other verb in it, so without a row of its own it came
  // back as `other` and the card derived nothing — Thrummingbird read as a vanilla bear. The
  // lookahead keeps a REPLACEMENT effect out: Tekuthal's "if you would proliferate, proliferate
  // twice instead" doubles someone else's proliferate and produces none of its own.
  [/\bproliferate\b(?![^.]*\binstead\b)/i, "proliferate"],
  [new RegExp(`\\bcreates?\\s+(${COUNT})\\b`, "i"), "create", 1],
  [/\bshuffles?\b/i, "shuffle"],
  [/\btakes? an extra turn\b/i, "extra-turn"],
  [/\badditional combat phase\b/i, "extra-combat"],
  [/\bexiles?\b/i, "exile"],
  [/\bsacrifices?\b/i, "sacrifice"],
  [/\bdiscards?\b/i, "discard"],
  [/\bsearch(?:es)?\s+(?:your|their|that player's)\b/i, "search"],
  [/\bunta(?:p|ps)\b/i, "untap"],
  [/\btaps?\b(?!\s*,)/i, "tap"],
  [/\badds?\s+\{/i, "add-mana"],
  [/\breturns?\b/i, "return"],
  // "put a +1/+1 counter on" is add-counter, never put; put is exclusively zone movement, so it
  // must see a destination zone before it fires.
  [/\bputs?\b[^.]{0,40}?\b(?:onto|into|on top of|on the bottom of)\b/i, "put"],
  [/\bputs?\b[^.]{0,40}?\bcounters?\s+on\b/i, "add-counter"],
  // Only an actual cast. "Spend this mana only to cast instant spells" is a restriction on the
  // mana and "whenever you cast" is a condition; neither casts anything.
  [/\b(?:you may cast|casts?\s+(?:it|that card|them|those cards))\b/i, "cast"],
];

/** The effect half of a clause: what the card DOES, with the parts that merely describe when it
 *  does it removed. Both exclusions were measured, not guessed — each was a false positive in the
 *  precision check:
 *    - a leading condition. "Whenever you draw a card" is not a draw, and "If you would draw a card
 *      while your library has no cards in it, you win the game instead" (Jace, Wielder of
 *      Mysteries) is a replacement effect whose only action is winning.
 *    - quoted text. An ability granted in quotes belongs to whatever receives it, not to this
 *      clause: Gideon, Ally of Zendikar's emblem says "Creatures you control get +1/+1", but the
 *      clause's own action is getting an emblem. (Quoted abilities that are themselves triggered or
 *      activated are already split into `granted` clauses of their own.) */
export function effectBody(text: string): string {
  const unquoted = text.replace(/"[^"]*"/g, " ");
  if (!/^(when|whenever|at\b|if\b)/i.test(unquoted.trim())) return unquoted;
  const comma = unquoted.indexOf(", ");
  return comma === -1 ? unquoted : unquoted.slice(comma + 2);
}

/** Actions stated by a clause's effect, in table order, as `verb` or `verb=amount`. Empty for an
 *  inert clause, which states no action at all — running the table over Saga reminder text derived
 *  a sacrifice from "(As this Saga enters ... sacrifice it)". */
export function effectActions(text: string, kind: ClauseKind = "ability"): string[] {
  if (kind === "keyword" || kind === "reminder" || kind === "level" || kind === "modal") return [];
  const body = effectBody(text);
  // A restriction states what does NOT happen. Tamiyo's "Spells and abilities your opponents
  // control can't cause you to sacrifice permanents or discard cards" is neither a sacrifice nor a
  // discard; the only verb it states is `cant`.
  if (/\b(?:can't|cannot)\b/i.test(body)) return [];
  const out: string[] = [];
  for (const [re, verb, group] of EFFECT_ACTIONS) {
    const m = re.exec(body);
    if (!m) continue;
    const raw = group ? m[group]?.toLowerCase() : undefined;
    const amount = raw ? WORD_NUMBER[raw] ?? (/^\d+$/.test(raw) ? raw : undefined) : undefined;
    out.push(amount ? `${verb}=${amount}` : verb);
  }
  return out;
}

/** The verbs whose zones are NOT implied by the verb itself. A draw is always library->hand and a
 *  mill always library->graveyard, so recording those invites two runs to disagree over a fact
 *  neither of them chose. Only these five genuinely vary. */
export const ZONED_VERBS = ["put", "return", "exile", "search", "cast"] as const;

/** Cost actions implied by an activation cost string, in the order written. */
export function costActions(cost: string): string[] {
  return COST_ACTIONS.filter(([re]) => re.test(cost)).map(([, verb]) => verb);
}

/** An ability granted inside quotes is a second ability living in one clause — Progenitor Mimic
 *  grants a triggered ability, Urza's Saga grants an activated one. The model tried to split these
 *  itself and invented clause ids to do it, breaking the completeness invariant, so split here. */
const GRANTED = /"([^"]{12,})"/g;
function extractGranted(text: string): { body: string; granted: string[] } {
  const granted: string[] = [];
  const body = text.replace(GRANTED, (m, inner: string) =>
    /^(When|Whenever|At\b)|^\{[^}]*\}[^:]*:/.test(inner.trim()) ? (granted.push(inner.trim()), "that ability") : m);
  return { body, granted };
}

/** A sentence starting a new trigger inside another clause ("Add {U}. When you spend this mana,
 *  ... ") is its own ability; leaving it inline let one run record it and the next ignore it. */
function splitEmbeddedTriggers(text: string): string[] {
  const parts = text.split(/(?<=\.)\s+(?=(?:When|Whenever|At)\b)/);
  return parts.map((p) => p.trim()).filter((p) => p !== "");
}

function classify(text: string, kind: ClauseKind, typeLine: string): { abilityType?: Clause["abilityType"]; cost?: string; body: string } {
  // Inert clauses state no game action: a printed keyword, reminder text, a Class level divider,
  // and the "Choose two —" line that introduces modes. The modes and the levelled-up abilities
  // carry the actions. Typing these as abilities invited the model to invent one.
  if (kind === "keyword" || kind === "reminder" || kind === "level" || kind === "modal") return { body: text };
  // A planeswalker loyalty ability is activated (CR 606); its cost is the loyalty symbol. Without
  // this, Aminatou's "+1: Draw a card" was typed static — the loyalty cost is not a mana symbol,
  // so the general cost pattern never matched it.
  const loyalty = text.match(LOYALTY);
  if (loyalty) return { abilityType: "activated", cost: loyalty[1].trim(), body: text.slice(loyalty[0].length) };
  // The trigger cue is tested BEFORE the cost, because no activated ability's cost begins
  // "Whenever" — but a triggered ability can carry a colon further along, in an ability it grants in
  // quotes. Glaring Fleshraker's token gets "Sacrifice this token: Add {C}.", whose cost is not a
  // mana symbol, so `extractGranted` leaves it inline and that colon offered itself as this clause's
  // cost. Order settles it for nothing.
  //
  // Test the cue behind a flavour label as well as at the front. ABILITY_WORD strips labels for the
  // marker, but only pure-letter ones of at most 24 characters, and the ones that slip past it are
  // exactly the ones that were being typed static while carrying a real trigger: "Allons-y! —"
  // (punctuation), "Lord of the Pyrrhian Legions —" (28 chars), "∞ —" (not a letter). The label is
  // never evidence on its own — only the cue behind it is — so a labelled static stays static.
  if (TRIGGER_CUE.test(text) || TRIGGER_CUE.test(text.replace(LABEL, ""))) {
    return { abilityType: "triggered", body: text };
  }
  const act = text.match(ACTIVATED);
  // Require the prefix to look like a cost: it must contain a mana symbol, {T}, or a cost word.
  if (act && /\{|sacrifice|discard|pay|remove|exile|tap\b/i.test(act[1])) {
    return { abilityType: "activated", cost: act[1].trim(), body: text.slice(act[0].length) };
  }
  if (kind === "chapter") return { abilityType: "triggered", body: text };
  return { abilityType: isSpellCard(typeLine) ? "spell" : "static", body: text };
}

const TRIGGER_CUE = /^(when|whenever|at the beginning|at end)/i;
/** Two trigger conditions in one clause. Anchored at the cue and confined to the text BEFORE the
 *  first comma, which is the trigger phrase: an "or" in the effect ("draw a card or discard a
 *  card") or between two objects ("target artifact or enchantment") must not count, because every
 *  clause wrongly marked buys the model one unchallenged extra clause on that card. Either a second
 *  full cue ("... and whenever you fully unlock a Room") or an "or" joining two event verbs
 *  ("enters or attacks", "dies or is put into a graveyard"). The second limb may name its own
 *  subject first — Scrap Trawler's "dies or another artifact you control is put into a graveyard" —
 *  so a short noun phrase is allowed between the "or" and its verb.
 *
 *  The "or" branch requires an event verb on BOTH sides, which is what separates two EVENTS from one
 *  event with two SUBJECTS. "Whenever this creature or another permanent enters" (River Kelpie) names
 *  one event the two nouns share; "whenever this creature dies or another artifact is put into a
 *  graveyard" (Scrap Trawler) names two. Without the left-hand verb, eight cards with a two-subject
 *  trigger followed by a printed keyword were told to answer the clause twice, the overflow record
 *  landed on the keyword's id, and the gate refused the whole card for a duplicate id and a trigger
 *  on a non-triggered clause. */
const EVENT_VERB = String.raw`(?:is put|is turned|attacks|blocks|becomes blocked|dies|enters|leaves|is dealt`
  // ACTIONS A PLAYER TAKES ARE EVENTS TOO, and their absence made a whole family invisible: the
  // detector that selects a doc for re-normalization (`missesASplit`) keys on this flag, so
  // "Whenever you create OR SACRIFICE a token" (Mirkwood Bats) was answered with one event, the
  // other silently dropped, and no selector could ever see it. MEASURED corpus-wide: 30 cards carry
  // a two-event trigger head whose verbs are all outside the original list, and the segmenter
  // flagged 0 -- "cycle or discard" (6), "play a land from exile or cast a spell from exile" (3),
  // "create or sacrifice", "gain or lose life", "cast or cycle".
  + String.raw`|cycles?|discards?|creates?|sacrifices?|casts?|plays?|mills?|exiles?)`;
const TWO_CONDITIONS = new RegExp(
  String.raw`^(?:when|whenever|at the beginning)[^,]*?\b(?:and (?:when|whenever|at the beginning)\b`
  + String.raw`|${EVENT_VERB}[^,]*?\bor (?:[a-z' ]{1,40}\s)?${EVENT_VERB}\b)`,
  "i",
);
/** Any leading label ending in a spaced em dash, however it is spelled. Deliberately wider than
 *  ABILITY_WORD: this one only decides whether to LOOK for a trigger cue behind it, so admitting a
 *  label that is not really one costs nothing unless a cue follows. Bounded so it cannot swallow a
 *  sentence, and dash-free so it stops at the first label.
 *
 *  Spacecraft print their threshold abilities as "3+ | Whenever ...", which is the same shape with a
 *  different separator — without it Uthros Research Craft and Entropic Battlecruiser type a printed
 *  trigger as static, and the persist gate refuses the whole card. */
const LABEL = /^(?:[^—]{1,40}—|\d+\+\s*\|)\s*/;
const CHAPTER = /^([IVX]+(?:\s*,\s*[IVX]+)*)\s*[—-]\s*/;
const ABILITY_WORD = /^([A-Z][A-Za-z' ]{2,24})\s*—\s*/;
/** A keyword ability whose cost follows an em dash with NO space: "Ward—Discard a card at random."
 *  Scryfall lists ability words in `keywords` too (Landfall, Threshold, Delirium), so membership
 *  alone cannot tell the two apart — but the SPACING can, and the corpus is unanimous: unspaced and
 *  in `keywords` is only ever a real keyword (Ward 50, Escape 32, Cumulative upkeep 20, Kicker,
 *  Flashback, Equip, Morph, Buyback, Echo), while every ability word takes a spaced dash. The label
 *  must end in a letter so "Void — Whenever ..." cannot match by absorbing the space. */
const KEYWORD_COST = /^([A-Z][A-Za-z' ]{1,23}[A-Za-z])—/;
const LEVEL = /^(\{[^}]*\}(?:\s*\{[^}]*\})*)\s*:\s*(Level\s+\d+)/i;
/** A planeswalker loyalty cost: "+1:", "-3:", "0:", "+X:", using either hyphen or minus sign. */
const LOYALTY = /^([+\u2212-]?(?:\d+|X))\s*:\s+/;

/** Strip reminder text but remember whether anything else remained. */
function stripReminder(line: string): string {
  return line.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
}

/** Is every comma-separated part of this line a printed keyword of the card? Keywords take
 *  arguments ("protection from Demons", "ward {2}"), so match on a part STARTING WITH one. */
function isKeywordLine(line: string, keywords: string[]): boolean {
  if (line === "") return false;
  // AN ABILITY WORD IS NOT A KEYWORD LINE. Scryfall's `keywords` lists ability words and keyword
  // ACTIONS alongside keyword abilities, and a line may START with one and then state a real
  // ability: "Threshold — This creature gets +7/+7 as long as ...", "Alluring Eyes — {T}: Goad
  // target creature ...". Marking those inert threw the whole ability away. The em dash is the
  // reliable marker — an ability word is always printed with one, a keyword line never has one.
  if (line.includes("—")) return false;
  // A keyword line NAMES something, at most with a parameter ("Ward {2}", "Protection from Demons",
  // "Annihilator 2"). It never ends in a full stop. "Regenerate target creature." and "Mill seven
  // cards. Then put all cards ..." both begin with a printed keyword ACTION and are whole sentences;
  // without this, Death Ward and Beluna Grandsquall lose their entire text.
  if (line.trimEnd().endsWith(".")) return false;
  const kw = keywords.map((k) => k.toLowerCase());
  return line
    .toLowerCase()
    .split(/,\s*/)
    .every((part) => kw.some((k) => part.trim() === k || part.trim().startsWith(`${k} `)));
}

/** Split a card's oracle text into numbered clauses. Deterministic: the same text always yields
 *  the same clause list, which is the property the LLM could not provide. */
export function segment(oracleText: string, keywords: string[] = [], typeLine = ""): Clause[] {
  const out: Clause[] = [];
  let id = 0;
  // Classification is PER FACE. The corpus joins faces into one type line, so a card whose back is
  // an instant made `isSpellCard` true for the FRONT face too, and every unclassified line there
  // defaulted to "spell" -- which derive maps to "on-cast". That produced on-cast abilities for 27
  // clauses in the calibration scope, including land faces ("This land enters tapped"), and an
  // unwarranted on-cast is the spellslinger mesh this layer already had to fix once.
  const faceTypes = typeLine.split(" // ");
  let face = 0;
  const next = (c: Omit<Clause, "id">): Clause => {
    const { abilityType, cost, body } = classify(c.text, c.kind, faceTypes[face] ?? typeLine);
    // An inert clause is classified as-is, so a cost supplied by the caller (a level divider's
    // level-up cost) is the only one there is.
    const effectiveCost = cost ?? c.cost;
    const ca = effectiveCost ? costActions(effectiveCost) : [];
    // Derived from the effect only — the cost was split off above, so a sacrifice cost is not
    // counted twice.
    const ea = effectActions(body, c.kind);
    const clause: Clause = {
      id: ++id, ...c, text: body,
      ...(abilityType ? { abilityType } : {}), ...(cost ? { cost } : {}),
      ...(TWO_CONDITIONS.test(body) ? { multiTrigger: true as const } : {}),
      ...(ca.length ? { costActions: ca } : {}),
      ...(ea.length ? { effectActions: ea } : {}),
    };
    out.push(clause);
    return clause;
  };

  for (const rawLine of (oracleText ?? "").split("\n")) {
    const raw = rawLine.trim();
    if (raw === "") continue;
    // The corpus joins a multi-face card's faces with a bare "//" line. It is a printed separator,
    // not rules text: it states no action, and giving it a slot meant asking the model about it --
    // and paying for the answer -- on all 116 multi-face cards in the calibration scope. It is also
    // the only marker of where one face ends and the next begins.
    if (raw === "//") { face++; continue; }
    const line = stripReminder(raw);
    // A line that was ONLY reminder text still gets a slot, so clause ids account for every line.
    if (line === "") { next({ kind: "reminder", text: raw }); continue; }

    let marker: string | undefined;
    let body = line;
    const chapter = body.match(CHAPTER);
    const level = LEVEL.exec(body);
    if (chapter) { marker = chapter[1]; body = body.slice(chapter[0].length); }
    // The divider carries the level it unlocks and what it costs to get there; the abilities that
    // come with the level are the lines after it. Previously the whole line was handed on as text
    // and always matched the activated-cost pattern first, so the branch written for levels never
    // ran and the clause read "Level 2" with no marker.
    else if (level) { next({ kind: "level", text: "", marker: level[2], cost: level[1].trim() }); continue; }
    else {
      const kw = body.match(KEYWORD_COST);
      if (kw && keywords.some((k) => k.toLowerCase() === kw[1].toLowerCase())) {
        next({ kind: "keyword", text: body, marker: kw[1] });
        continue;
      }
      const word = body.match(ABILITY_WORD);
      // An ability word ("Landfall —") is a label, not a cost; a "{T}: ..." activated cost is not.
      if (word && !body.startsWith("{")) { marker = word[1].trim(); body = body.slice(word[0].length); }
    }

    // "Choose two —" prints on its own line, so stripping the label left an empty body that
    // produced NO clause at all — and the first bullet then invented an empty unlabelled parent to
    // hang off. Keep the intro as its own inert clause and let the modes attach to it.
    if (body === "" && marker) { next({ kind: "modal", text: "", marker }); continue; }

    // Modal text: "choose one —" then • bullets, which may share the line or be on their own.
    // A bullet-only line attaches to the most recent non-mode clause, so every mode of one modal
    // ability hangs off the same parent however the printing wrapped it.
    if (body.includes("•")) {
      const [head, ...modes] = body.split("•");
      let parentId: number;
      if (head.trim() === "") {
        const prior = [...out].reverse().find((c) => c.kind !== "mode");
        parentId = prior?.id ?? next({ kind: "ability", text: "", marker }).id;
      } else {
        parentId = next({ kind: chapter ? "chapter" : "ability", text: head.trim(), marker }).id;
      }
      // A mode belongs to its parent's ability: Bow of Nylea's modes are part of an activated
      // ability, and typing them static made the mode read as a permanent's standing effect.
      const parentType = out.find((c) => c.id === parentId)?.abilityType;
      for (const m of modes) {
        const t = m.trim();
        if (t) {
          const mode = next({ kind: "mode", text: t, parentId });
          // ...unless the mode states a trigger of its OWN. Outpost Siege and Mirrodin Besieged hang
          // two full triggered abilities off a static "As this enters, choose X" parent, and
          // inheriting there types a printed trigger static.
          if (parentType && mode.abilityType !== "triggered") mode.abilityType = parentType;
        }
      }
      continue;
    }

    if (isKeywordLine(body, keywords)) { next({ kind: "keyword", text: body, marker }); continue; }
    const pieces = splitEmbeddedTriggers(body);
    pieces.forEach((piece, i) => {
      const { body: outer, granted } = extractGranted(piece);
      const parent = next({ kind: chapter ? "chapter" : "ability", text: outer, ...(i === 0 ? { marker } : {}) });
      for (const g of granted) next({ kind: "granted", text: g, parentId: parent.id });
    });
  }
  return out;
}
