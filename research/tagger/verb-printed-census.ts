// LOCAL RESEARCH ONLY (#1321 phase 1): census, per stored ACTION, of the verb the clause was filed under against the PRINTED text of the action's own clause.
// FREE: reads Mongo (cards, cardClauses, cardTagsDerived), writes nothing, changes no derive output. ~1 min (the blast-radius pass re-derives each flagged card once).
// An action is "misfiled" when its clause (reminder text stripped) prints NONE of the verb's words (`WORDS` below: FLIP_VERB_WORDS + the verb's first word + legitimate paraphrase).
// Which records are read follows what derive used: a card whose derived row says `clauseSource: "grammar"` is read from `grammarClauseRecords`, every other from `cardClauses.canonical`.
// Blast radius: re-derive the card with the one action removed; "emits" = emits lost, "kinds" = abilities / effect kinds lost.
// Run from the repo root after `set -a && source packages/tagger/.env && set +a`:
//   npx tsx research/tagger/verb-printed-census.ts [--examples 3] [--dump <verb>] [--no-blast]
import { connect, loadConfig } from "@edh-seer/data";
import { clauseCosts, clauseTexts, deriveInputOf } from "../../packages/tagger/src/derive-input.js";
import { deriveCardTags, FLIP_VERB_WORDS } from "../../packages/tagger/src/derive/derive.js";
import { grammarClauseRecords } from "../../packages/tagger/src/grammar/clause-record.js";
import type { CardTags } from "../../packages/tagger/src/schema.js";

const args = process.argv.slice(2);
const argOf = (f: string): string | undefined => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const EXAMPLES = Number(argOf("--examples") ?? 3), DUMP = argOf("--dump"), BLAST = !args.includes("--no-blast");

/** Per-verb printed words (regex source, matched case-insensitively on the clause with reminder text removed). Where absent: FLIP_VERB_WORDS, else the verb's first word with s/es/ed/ing. */
const KEYWORD = (w: string): string => `${w}(?:s|es|ed|ing)?`;
const WORDS: Record<string, string> = {
  "sacrifice": "sacrifice(?:s|d)?|sacrificing",
  "exile": "exil(?:e|es|ed|ing)", "destroy": "destroy(?:s|ed|ing)?|destruction", "tap": "tap(?:s|ped|ping)?|\\{t\\}", "untap": "untap(?:s|ped|ping)?|\\{q\\}",
  "draw": "draw(?:s|ing)?|drew", "mill": "mill(?:s|ed)?|graveyard", "search": "search(?:es|ed|ing)?|look(?:s)? at|reveals? cards? from the top", "put": "puts?|placed?|placing|putting|enters?|entered|begin the game|moves?|shuffles? .* into|onto the battlefield",
  "return": "returns?|returned|returning|back|until .* leaves the battlefield|until .* leaves play", "counter-spell": "counters?|countered",
  "copy": "cop(?:y|ies|ied|ying)", "gain-life": "gains?|gained|life|lifelink", "lose-life": "loses?|lost|life", "deal-damage": "deals?|dealt|damage",
  "add-mana": "adds?|added|mana", "add-counter": "puts?|put|counters?|bolster|adapt|proliferate|support|distribute|moves?|gets? \\{e\\}|enters? with|enters the battlefield with|place",
  "remove-counter": "removes?|removed|counters?|proliferate", "grant-ability": "gains?|gained|has|have|had|with|gets?|can|can't|cannot|protection|haste|flying|lifelink|deathtouch|trample|vigilance|first strike|double strike|menace|reach|hexproof|indestructible|ward|keyword|ability|abilities|\\bis\\b|\\bare\\b|becomes?|loses?|doesn't|don't",
  "modify-pt": "\\d+/\\d+|gets?|get|[+-]\\d+/[+-]\\d+|[+-]x/[+-]x|base power|power|toughness|becomes?|has|have|with|equal to|swap|exchange|double|triple",
  "prevent": "prevent(?:s|ed)?|prevention|instead|redirect|can't|cannot|won't|doesn't|don't|would be dealt",
  "cast": "cast(?:s|ing)?|casts?|play|plays|copy|copies", "play": "plays?|played|playing|cast(?:s|ing)?|land|lands",
  "shuffle": "shuffl(?:e|es|ed|ing)", "reveal": "reveal(?:s|ed|ing)?|shows?|look(?:s|ed)? at", "attach": "attach(?:es|ed|ing)?|equip(?:ped)?|fortif(?:y|ied)|enchant(?:ed)?|aura|reconfigure|bestow|unattach",
  "transform": "transform(?:s|ed|ing)?|daybound|nightbound|disturb|meld|flip|convert|back face|day|night", "trigger-again": "trigger(?:s|ed)?|additional time|twice|an extra time|again|copy|copies|additional",
  "extra-turn": "extra turns?|additional turns?|takes? another turn|another turn", "extra-combat": "additional combat|extra combat|another combat|after this phase",
  "animate": "becomes?|is a|are|turns? into|creature|until end of turn|enchanted|equipped|isn't|loses?|gets?|has|have|with", "cant": "loses?|lose|must|if able|skip(?:s|ped)?|can't|cannot|can not|don't|doesn't|isn't|aren't|won't|may not|no more|only|unable|unless|not|no |without|instead|except",
  "emblem": "emblem", "fight": "fights?|fought|fighting", "set-life": "life|total|becomes?", "cost-modify": "spend|spent|affinity|costs?|less|more|additional|pays?|paid|payment|\\{[^}]+\\}|reduce|increase|free|without paying|alternative|instead",
  "turn-face-up": "face[- ]up|turns? .* face|unmorph|megamorph|manifest|disguise|morph|cloak|face down|face-down",
  "extra-phase": "additional|extra|another|phase", "manifest-dread": "manifest dread", "time-travel": "time travel", "collect-evidence": "collect evidence",
  "venture-into-the-dungeon": "venture", "face-a-villainous-choice": "villainous choice", "ring-tempts": "ring tempts|the ring", "roll-dice": "rolls?|rolled|dice|die",
  "flip-coin": "flips?|flipped|coin", "city-blessing": "city's blessing|ascend", "gain-control": "gains? control|takes? control|under .* control|controls?|exchange control|control of",
  "phase-out": "phases? out|phased out", "phase-in": "phases? in|phased in", "win-game": "wins? the game|win the game|wins", "lose-game": "loses? the game|lose the game",
  "empower-jace": "empower|jace", "prepare": "prepar(?:e|ed)", "unprepare": "unprepar(?:e|ed)", "unattach": "unattach|attached|attach", "monarch": "monarch", "initiative": "initiative",
  "day-night": "day|night", "create": "creates?|created|token|populate|incubate|investigate|amass|clue|treasure|food|blood|map|powerstone|junk|gold|shard|copy|copies|manifest|cloak|conjure", "double": "double|twice|triple", "triple": "triple",
  "exchange": "exchange|swap|switch", "convert": "convert|transform|becomes?", "regenerate": "regenerat(?:e|es|ed|ion)", "goad": "goad(?:s|ed)?", "exert": "exert(?:s|ed)?",
  "detain": "detain(?:s|ed)?", "suspect": "suspect(?:s|ed)?", "harness": "harness(?:es|ed)?", "vote": "vot(?:e|es|ed|ing)", "clash": "clash(?:es|ed)?", "fateseal": "fateseal(?:s|ed)?",
  "behold": "behold(?:s)?", "heal": "heal|remove(?:s)? all damage|removes? damage|damage .* removed", "learn": "learn(?:s)?", "endure": "endur(?:e|es|ed)", "forage": "forag(?:e|es|ed)",
  "explore": "explor(?:e|es|ed)", "connive": "conniv(?:e|es|ed|ing)", "recruit": "recruit(?:s|ed)?", "bolster": "bolster(?:s|ed)?", "support": "support(?:s|ed)?", "adapt": "adapt(?:s|ed)?",
  "monstrosity": "monstrosity|monstrous", "blight": "blight(?:s|ed)?", "investigate": "investigat(?:e|es|ed)|clue", "populate": "populat(?:e|es|ed)", "incubate": "incubat(?:e|es|ed)|incubator", "manifest": "manifest(?:s|ed)?",
  "discover": "discover(?:s|ed)?", "cloak": "cloak(?:s|ed)?", "earthbend": "earthbend(?:s|ed)?", "scry": "scry|scries", "surveil": "surveil(?:s|ed)?", "amass": "amass(?:es|ed)?", "foretell": "foretell|foretold|foretells",
  "airbend": "airbend", "waterbend": "waterbend", "proliferate": "proliferat(?:e|es|ed)",
};
for (const [k, v] of Object.entries(FLIP_VERB_WORDS)) WORDS[k] = [WORDS[k], v].filter(Boolean).join("|");
const SKIP = new Set(["none", "other"]);
const wordRe = new Map<string, RegExp>();
function printsVerb(verb: string, text: string): boolean {
  let re = wordRe.get(verb);
  if (!re) { re = new RegExp(`\\b(?:${WORDS[verb] ?? KEYWORD(verb.split("-")[0]!)}|${KEYWORD(verb.split("-")[0]!)})(?![\\w'])|^(?:${WORDS[verb] ?? ""})$`, "i"); wordRe.set(verb, re); }
  return re.test(text);
}
/** Reminder text out. Parentheses nest at most one deep in the corpus. */
const noReminder = (t: string): string => t.replace(/\([^()]*(?:\([^()]*\)[^()]*)*\)/g, " ");

type Act = { verb: string; object?: string; fromZone?: string | null; toZone?: string | null };
type Rec = { id: number; abilityType?: string; actions: Act[] };
const store = await connect(loadConfig());
const derived = store.db.collection<{ oracleId: string; clauseSource?: string; isToken?: boolean }>("cardTagsDerived");
const clauseCol = store.db.collection<{ oracleId: string; canonical: Rec[] }>("cardClauses");
const rows = await derived.find({}, { projection: { oracleId: 1, clauseSource: 1, isToken: 1 } }).toArray();
const canon = new Map<string, Rec[]>();
for await (const d of clauseCol.find({}, { projection: { oracleId: 1, canonical: 1 } })) canon.set(d.oracleId, d.canonical);

type Flag = { source: "model" | "grammar"; name: string; oracleId: string; clause: number; k: number; verb: string; object: string; text: string; emits: number; kinds: number };
const totals = { model: 0, grammar: 0, tokenRows: 0, noText: 0, noRecords: 0 };
const perVerb = new Map<string, { total: number; modelTotal: number; grammarTotal: number; flags: Flag[] }>();
const flags: { flag: Flag; card: Record<string, unknown>; recs: Rec[]; readings: unknown }[] = [];

const BATCH = 500;
for (let b = 0; b < rows.length; b += BATCH) {
  const batch = rows.slice(b, b + BATCH);
  const cards = new Map<string, Record<string, unknown>>();
  for (const c of await store.cards.find({ _id: { $in: batch.map((r) => r.oracleId) } } as never).toArray()) cards.set(c._id as unknown as string, c as never);
  for (const row of batch) {
    const card = cards.get(row.oracleId);
    if (!card) { totals.tokenRows++; continue; }
    const source: "model" | "grammar" = row.clauseSource === "grammar" ? "grammar" : "model";
    let recs: Rec[] | undefined, readings: unknown;
    if (source === "grammar") { const g = grammarClauseRecords(card as never); recs = g.records as never; readings = g.readings; } else recs = canon.get(row.oracleId);
    if (!recs) { totals.noRecords++; continue; }
    const activated = new Set(recs.filter((r) => r.abilityType === "activated").map((r) => r.id));
    const texts = { ...clauseTexts(card as never, activated) }, costs = clauseCosts(card as never, activated);
    for (const id of Object.keys(costs)) if (texts[Number(id)] !== undefined) texts[Number(id)] = `${costs[Number(id)]} : ${texts[Number(id)]}`; // the cost is part of the clause (a cost is printed in the same clause as the effect)
    for (const r of recs) {
      const text = texts[r.id];
      r.actions.forEach((a, k) => {
        if (SKIP.has(a.verb)) return;
        const v = perVerb.get(a.verb) ?? { total: 0, modelTotal: 0, grammarTotal: 0, flags: [] };
        perVerb.set(a.verb, v);
        v.total++; totals[source]++; if (source === "model") v.modelTotal++; else v.grammarTotal++;
        if (text === undefined) { totals.noText++; return; }
        // A KEYWORD LINE ("Crew 4", "Equip {3}", "Cycling {2}", "Escape-{G}{G}, Exile five other cards") is its reminder text: the action IS the reminder, so a short stripped line is tested with the reminder kept.
        const stripped = noReminder(text).replace(/\s+/g, " ").trim();
        if (printsVerb(a.verb, stripped) || (stripped.length <= 60 && printsVerb(a.verb, text))) return;
        const flag: Flag = { source, name: String(card.name), oracleId: row.oracleId, clause: r.id, k, verb: a.verb, object: String(a.object ?? ""), text: noReminder(text).replace(/\s+/g, " ").trim(), emits: 0, kinds: 0 };
        v.flags.push(flag);
        flags.push({ flag, card, recs, readings });
      });
    }
  }
}

const countEmits = (t: CardTags): number => t.abilities.reduce((n, a) => n + (a.emits?.length ?? 0), 0);
const kindBag = (t: CardTags): Map<string, number> => { const m = new Map<string, number>(); for (const a of t.abilities) { const key = `${a.clause}:${a.effect?.kind ?? a.kind}`; m.set(key, (m.get(key) ?? 0) + 1); } return m; };
if (BLAST) {
  const baseCache = new Map<string, CardTags>();
  for (const { flag, card, recs, readings } of flags) {
    const input = (rs: Rec[]) => deriveInputOf(card as never, flag.oracleId, flag.name, rs as never, undefined, flag.source === "grammar" ? readings as never : undefined);
    try {
      const baseKey = `${flag.source}:${flag.oracleId}`;
      const base = baseCache.get(baseKey) ?? deriveCardTags(input(recs));
      baseCache.set(baseKey, base);
      const without = recs.map((r) => r.id === flag.clause ? { ...r, actions: r.actions.filter((_, i) => i !== flag.k) } : r);
      const after = deriveCardTags(input(without));
      flag.emits = Math.max(0, countEmits(base) - countEmits(after));
      const kb = kindBag(base), ka = kindBag(after);
      for (const [key, n] of kb) flag.kinds += Math.max(0, n - (ka.get(key) ?? 0));
    } catch { /* grammar readings are indexed by action; a removal that misaligns them is left at 0 and counted below */ flag.emits = -1; flag.kinds = -1; }
  }
}

const rank = [...perVerb.entries()].map(([verb, v]) => ({ verb, ...v, emits: v.flags.reduce((n, f) => n + Math.max(0, f.emits), 0), kinds: v.flags.reduce((n, f) => n + Math.max(0, f.kinds), 0), withBlast: v.flags.filter((f) => f.emits > 0 || f.kinds > 0).length }))
  .sort((a, b) => b.flags.length - a.flags.length || b.total - a.total);

if (DUMP) {
  for (const f of perVerb.get(DUMP)?.flags ?? []) console.log(`${f.source} | ${f.name} [${f.clause}#${f.k}] ${f.verb} :: ${f.object} || ${f.text}`);
} else {
  const model = rank.reduce((n, r) => n + r.flags.filter((f) => f.source === "model").length, 0), grammar = rank.reduce((n, r) => n + r.flags.filter((f) => f.source === "grammar").length, 0);
  console.log(`actions scanned ${totals.model + totals.grammar} (model ${totals.model}, grammar ${totals.grammar}); flagged ${model + grammar} (model ${model}, grammar ${grammar}); token rows skipped ${totals.tokenRows}; no clause text ${totals.noText}; rows with no records ${totals.noRecords}`);
  console.log(`verb | actions | misfiled (model/grammar) | rate | misfiled with an emit lost or a kind lost | emits lost | abilities lost`);
  for (const r of rank) {
    if (r.flags.length === 0) continue;
    const m = r.flags.filter((f) => f.source === "model").length;
    console.log(`${r.verb} | ${r.total} | ${r.flags.length} (${m}/${r.flags.length - m}) | ${(100 * r.flags.length / r.total).toFixed(1)}% | ${r.withBlast} | ${r.emits} | ${r.kinds}`);
    const ex = [...r.flags].sort((a, b) => (b.emits + b.kinds) - (a.emits + a.kinds) || a.name.localeCompare(b.name)).slice(0, EXAMPLES);
    for (const f of ex) console.log(`    ${f.name} [${f.source} ${f.clause}] ${f.verb} :: ${f.object.slice(0, 70)} || ${f.text.slice(0, 160)}${f.emits || f.kinds ? `  {emits ${f.emits}, kinds ${f.kinds}}` : ""}`);
  }
  const clean = rank.filter((r) => r.flags.length === 0).map((r) => `${r.verb}(${r.total})`);
  console.log(`verbs with 0 misfiled: ${clean.join(", ")}`);
}
await store.close();
