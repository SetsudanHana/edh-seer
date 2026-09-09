/** EVERY TRIGGER HEAD THE COMMANDER-LEGAL CORPUS PRINTS, bucketed by whether `TRIGGERS` can spell it.
 *
 *  AC1 (2026-09-09): the trigger vocabulary is argued from the RULES, and this is the corpus side of
 *  that argument — for each printed head verb ("whenever you cycle", "whenever a creature you
 *  control fights", "whenever ... becomes tapped") the count of commander-legal cards, so a
 *  rule-defined event can be paired with its corpus size and a verdict written down. Free,
 *  read-only. Prints the heads with no spelling, largest first. */
import { connect, loadConfig } from "@edh-seer/data";
import { TRIGGERS } from "../../packages/tagger/src/normalize-prompt.js";

const store = await connect(loadConfig());
const cards = await store.cards
  .find({ "legalities.commander": "legal" } as never, { projection: { name: 1, oracleText: 1 } })
  .toArray() as unknown as { name: string; oracleText?: string }[];

/** The head of a trigger line: the verb phrase right after "when/whenever <subject>". */
const ACTIVE = /\b(?:when|whenever)\s+(?:you|a player|an opponent|any player|each player|one or more players|a teammate|that player|they)\s+(?:(?:would|first|next|do not|don't)\s+)?([a-z]+(?:\s+(?:a|an|the|into|to|for|on|from|with|or|and|your|their|one|two|three)\b)?)/gi;
const PASSIVE = /\b(?:when|whenever)\s+(?:[^,.]{0,60}?)\s+(?:is|are|becomes?|become|gets?|has|have)\s+(?:the\s+)?([a-z]+(?:\s+(?:up|out|in|on|with|from|by|for|into|as|to)\b)?)/gi;
const AT = /\bat the beginning of (?:each|your|an opponent's|each opponent's|each player's|the|that player's|combat on your turn|each combat)?\s*([a-z' ]{3,30}?)(?:\s+(?:step|phase))?[,.]/gi;

const active = new Map<string, Set<string>>();
const passive = new Map<string, Set<string>>();
const at = new Map<string, Set<string>>();
const add = (m: Map<string, Set<string>>, k: string, name: string) => m.set(k, (m.get(k) ?? new Set()).add(name));

for (const c of cards) {
  const text = (c.oracleText ?? "").replace(/\([^)]*\)/g, "");
  for (const line of text.split("\n")) {
    for (const m of line.matchAll(ACTIVE)) add(active, m[1].toLowerCase().split(/\s+/)[0], c.name);
    for (const m of line.matchAll(PASSIVE)) add(passive, m[1].toLowerCase(), c.name);
    for (const m of line.matchAll(AT)) add(at, m[1].toLowerCase().trim(), c.name);
  }
}

const words = new Set(TRIGGERS);
const print = (title: string, m: Map<string, Set<string>>, min = 2) => {
  console.log(`\n=== ${title} ===`);
  for (const [k, v] of [...m].sort((a, b) => b[1].size - a[1].size)) {
    if (v.size < min) continue;
    const spelled = [...words].filter((w) => w.replace(/-/g, " ").startsWith(k.slice(0, 4)) || k.startsWith(w.split("-")[0].slice(0, 4)));
    console.log(`  ${String(v.size).padStart(5)}  ${k.padEnd(28)} ${spelled.length ? `~ ${spelled.join(", ")}` : "(no word)"}   e.g. ${[...v].slice(0, 3).join(" · ")}`);
  }
};
console.log(`commander-legal cards: ${cards.length}`);
print("WHEN/WHENEVER <player> <verb>", active);
print("WHEN/WHENEVER <thing> is/becomes <state>", passive);
print("AT THE BEGINNING OF <step>", at);
await store.close();
process.exit(0);
