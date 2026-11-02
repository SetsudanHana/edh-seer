/** WHAT A "DEALS DAMAGE" TRIGGER ON THE CARD ITSELF OR ON ITS HOST PRINTS (#1471): whether it watches the permanent the card is attached to ("Whenever enchanted creature deals damage",
 *  Armadillo Cloak; "equipped creature", Neko-Te), and whom the damage must be dealt to ("... to a player", Abyssal Specter; "to an opponent", Witherscale Wurm). The matcher judges another card's
 *  damage against these: its dealer must be able to be this card (or its host), and its recipient must be able to be the one printed.
 *  Read by search, not a lazy regex (CodeQL js/polynomial-redos). A trigger that names neither the card nor its host is not read (a class trigger, "whenever a creature you control deals damage").
 *  CEILING: only the recipients below are read ("a player or planeswalker", "a creature or planeswalker", "that player", "you" stay open: the damage is heard whoever it hits). */
import type { DamageVictim } from "../schema.js";

const RECIPIENTS: Readonly<Record<string, DamageVictim>> = {
  "a player": "player",
  "an opponent": "opponent",
  "one of your opponents": "opponent",
  "a creature": "creature",
  "a creature an opponent controls": "opponent-creature",
  "a player or battle": "player-or-battle",
};

/** The trigger phrase of a clause: from its first "when" / "whenever" up to the first comma, lower-cased. Empty when the clause has none. */
function triggerPhrase(clauseText: string): string {
  const lower = clauseText.toLowerCase();
  const at = lower.search(/\bwhen(?:ever)?\s/);
  if (at < 0) return "";
  const from = lower.slice(at);
  const comma = from.indexOf(",");
  return comma < 0 ? from : from.slice(0, comma);
}

/** The one "deals damage" trigger phrase of the whole card, when it prints exactly one: a MODE of a modal trigger ("Whenever this creature deals combat damage to a player, choose one -- * Create a Treasure token", Bejeweled Warg) is a clause of its own that
 *  keeps the trigger but not its words. Two different phrases (or none) read nothing. */
function onlyDamagePhrase(cardText: string): string {
  const found = new Set<string>();
  for (const line of cardText.split("\n")) {
    const phrase = triggerPhrase(line);
    if (phrase.includes(" deals ") && phrase.includes("damage")) found.add(phrase);
  }
  return found.size === 1 ? [...found][0]! : "";
}

export function damageTriggerReads(clauseText: string, self: boolean, cardText = ""): { host?: true; victim?: DamageVictim } {
  const phrase = triggerPhrase(clauseText) || onlyDamagePhrase(cardText);
  if (phrase === "") return {};
  const subject = phrase.slice(phrase.indexOf(" ") + 1).trimStart();
  // The ARTICLE is the tell: "an enchanted creature" is a class (CR 700.9), the Aura's own "enchanted creature" is its host.
  const host = /^(?:enchanted|equipped) [a-z]+ deals\b/.test(subject);
  if (!host && !self) return {};
  const to = phrase.indexOf("damage to ");
  const victim = to < 0 ? undefined : RECIPIENTS[phrase.slice(to + "damage to ".length).trim()];
  return { ...(host ? { host: true as const } : {}), ...(victim ? { victim } : {}) };
}
