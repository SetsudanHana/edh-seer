/** THE ONE PLACE A REASON SENTENCE IS BUILT.
 *
 *  It used to be six sites inside edges.ts, each assembling its own string, which is why the same
 *  pair could read two different ways on two tabs (skeptic persona, 2026-08-20).
 *
 *  The vocabulary this replaces was the ENGINE'S, not Magic's: "supplies it" appeared in both the
 *  precon player's and the deck tuner's unknown-word lists on the same day. */

/** kind -> [with amount, without amount]. A kind absent here yields null, which is rung 3 of the
 *  ladder: we say the payoff triggers and claim nothing about what it does. */
const PHRASES: Record<string, [(n: string) => string, string]> = {
  "draw-card": [(n) => `draws you ${n} card${n === "1" ? "" : "s"}`, "draws you cards"],
  drain: [(n) => `drains for ${n}`, "drains each opponent"],
  lifegain: [(n) => `gains you ${n} life`, "gains you life"],
  damage: [(n) => `deals ${n} damage`, "deals damage"],
  "player-life-loss": [(n) => `costs each opponent ${n} life`, "costs each opponent life"],
  "counter-placement": [(n) => `puts ${n} counters on it`, "puts counters on it"],
  "token-generation": [(n) => `makes ${n} tokens`, "makes a token"],
  "mana-generation": [(n) => `adds ${n} mana`, "adds mana"],
  "graveyard-recursion": [() => "brings a card back", "brings a card back"],
  pump: [(n) => `gives +${n}/+${n}`, "makes your creatures bigger"],
  "cost-reduction": [(n) => `costs ${n} less`, "costs less"],
};

export function effectPhrase(kind: string | undefined, amount: string | undefined): string | null {
  if (!kind) return null;
  const entry = PHRASES[kind];
  if (!entry) return null;
  const [withAmount, without] = entry;
  return amount ? withAmount(amount) : without;
}

/** verb -> third-person verb phrase ("<producer> <phrase>" must read as English). Mirrors the noun
 *  phrases `humanizeEvent` builds in edges.ts (line 598) without reusing them: a noun phrase like
 *  "a creature entering" cannot be conjugated back into a verb generically ("being cast", "hitting
 *  the graveyard" and "a counter being put on it" have no regular inverse), so this is its own map
 *  over the same VERB_VOCAB (`@mtg/tagger`), keyed on the verb half of a zone-event key alone — the
 *  subject/type half is discarded here, because the cause names the PRODUCER CARD, never its class. */
const VERB_PHRASES: Record<string, string> = {
  enters: "enters",
  "enters-graveyard": "hits the graveyard",
  dies: "dies",
  leaves: "leaves the battlefield",
  cast: "is cast",
  attacks: "attacks",
  taps: "becomes tapped",
  untaps: "untaps",
  "counter-added": "gets a counter",
  "gain-life": "gains life",
  "lose-life": "makes a player lose life",
  sacrifice: "sacrifices something",
  "create-token": "makes a token",
  proliferate: "proliferates",
  // The rest of VERB_VOCAB: nouns wearing a verb's job, where "verb + s" reads as nonsense
  // ("combat-damages", "land-plays", "dice-rolleds").
  "combat-damage": "deals combat damage",
  "non-combat-damage": "deals noncombat damage",
  draw: "draws a card",
  discard: "discards a card",
  mill: "mills a card",
  "land-play": "plays a land",
  "dice-rolled": "rolls a die",
  // Phase triggers. Nothing in the corpus ever EMITS these (no card supplies your upkeep — see
  // CLAUDE.md, VERB_VOCAB), so a producer's eventKey should never carry one; kept for completeness
  // rather than left to the ungrammatical naive fallback below.
  upkeep: "reaches its upkeep",
  "begin-combat": "enters combat",
  "end-step": "reaches the end step",
};

/** Turn a zone-event key ("enters:creature", "dies:artifact") into the verb phrase that follows a
 *  card's name. Unlike `humanizeEvent`, the subject half is dropped: the sentence names the
 *  PRODUCER CARD as the cause, not a class of card, so "a creature" would be redundant at best and
 *  wrong once the class doesn't describe the actual producer (an artifact creature dying still
 *  satisfies `dies:creature`). ponytail: a verb this map has never seen gets `verb + "s"`, which is
 *  wrong for the noun-shaped verbs above but is why they are all listed explicitly instead. */
export function eventVerbPhrase(key: string): string {
  const verb = key.split(":")[0] ?? key;
  return VERB_PHRASES[verb] ?? `${verb.replace(/-/g, " ")}s`;
}

/** Cause first: what happens, then what it does for you.
 *
 *  `self` means the CONSUMER watches its own event and the producer is what makes that event
 *  happen (Eldrazi Confluence blinking Solemn Simulacrum, which then draws a card) — so the cause
 *  names the consumer as the thing the event happens to, not the producer. */
export function reasonSentence(input: {
  producer: string; consumer: string; eventKey: string;
  effectKind?: string; amount?: string; self?: boolean;
}): string {
  const verb = eventVerbPhrase(input.eventKey);
  const phrase = effectPhrase(input.effectKind, input.amount);
  if (input.self) {
    const effect = phrase ? `it ${phrase}` : "it triggers";
    return `When ${input.consumer} ${verb} thanks to ${input.producer}, ${effect}`;
  }
  const cause = `When ${input.producer} ${verb}`;
  return phrase ? `${cause}, ${input.consumer} ${phrase}` : `${cause}, ${input.consumer} triggers`;
}
