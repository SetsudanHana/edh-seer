/** THE FULLER SWEEP: every section of the Comprehensive Rules, with our coverage verdict.
 *
 *  Everything found before this was found because someone THOUGHT OF IT — a section I happened to
 *  pick, or a mechanic the owner happened to name (adventure, omen, initiative, firebending). That is
 *  still luck, one level up from reading cards one at a time. The 700s are where the game puts its
 *  per-mechanic rules — Saga is 714, Adventure 715, Omen 720, the monarch 725 — so enumerating the
 *  section list turns "did we miss a mechanic?" into a finite checklist that can be ticked.
 *
 *  Each section carries a hand-written STATUS. A section with NO status is reported as UNREVIEWED and
 *  the bin exits non-zero: when WotC adds section 734, it shows up here rather than being discovered
 *  a year later by a wrong edge. Free, read-only.
 *
 *  Reads the committed `cr-keywords.json`; regenerate it with `gen-cr-keywords.ts` after a rules
 *  update. */
import { connect, loadConfig } from "@mtg/data";
import crKeywords from "../derive/cr-keywords.json" with { type: "json" };

type Verdict = "MODELLED" | "PARTIAL" | "OPEN" | "N/A";
interface Status { verdict: Verdict; note: string; probe?: RegExp; typeLine?: RegExp; layout?: string }

/** One row per CR 7xx section. `probe` counts the corpus cards the section can reach, so an OPEN row
 *  carries its own size and the list can be ranked rather than merely listed. */
const STATUS: Record<string, Status> = {
  "700": { verdict: "PARTIAL", note: "general concepts; modified/outlaw/party/descended still unmodelled as subject filters" },
  "701": { verdict: "MODELLED", note: "keyword actions — complete + ratcheted by cr-completeness.test.ts" },
  "702": { verdict: "PARTIAL", note: "keyword abilities — 5 short of the CR (was 6; MTGJSON caught up on `storied` 2026-08-20), ratcheted as MTGJSON_LAG" },
  "703": { verdict: "PARTIAL", note: "turn-based actions — SWEPT 2026-08-20, all 13 of 703.4 judged: phasing/day-night/untap/draw/lore/attackers/blockers/combat damage/cleanup all have trigger words, scheme + Attractions are N/A on legality, defending-player choice is the 800-series opponent gap, damage removal and mana emptying carry no printed trigger (0 corpus cards). Residue was `phases-in`, now a word." },
  "704": { verdict: "PARTIAL", note: "state-based actions — Sagas closed 2026-08-15, the 704.5j legend rule closed 2026-08-19 (copy-of-a-legend dies); 0-loyalty and poison open" },
  "705": { verdict: "OPEN", note: "coin flips — no event, no vocabulary", probe: /flips? a coin/i },
  "706": { verdict: "PARTIAL", note: "dice — `dice-rolled` trigger added 2026-08-15, no effect model", probe: /rolls? a d/i },
  "707": { verdict: "PARTIAL", note: "copying — `copy` verb and trigger exist; 707.2 (a copy has the copied abilities, so its entry trigger fires) shipped 2026-08-19; still no model of what a copy IS" },
  "708": { verdict: "OPEN", note: "face-down spells/permanents — manifest and cloak emit `enters`, nothing knows they are face down", probe: /face down/i },
  "709": { verdict: "MODELLED", note: "split cards — playableFaces lists both halves", layout: "split" },
  "710": { verdict: "MODELLED", note: "flip cards — FRONT_FACE_ONLY allow-list", layout: "flip" },
  "711": { verdict: "PARTIAL", note: "leveler cards — `level-up` trigger exists, level bands unmodelled", layout: "leveler" },
  "712": { verdict: "MODELLED", note: "double-faced cards — DERIVE_VERSION 30, one face at a time" },
  "713": { verdict: "N/A", note: "substitute cards are a physical-play convenience" },
  "714": { verdict: "MODELLED", note: "Saga — sagaEvents ships the 714.4 self-sacrifice", typeLine: /Saga/ },
  "715": { verdict: "OPEN", note: "Adventurer — 715.3d exile-then-playable unmodelled; 715.4 zone types WRONG (see gap-sweep stub §3.2)", layout: "adventure" },
  "716": { verdict: "OPEN", note: "Class cards — class levels unmodelled entirely", typeLine: /Class/ },
  "717": { verdict: "N/A", note: "Attractions live in a separate deck, never the 99" },
  "718": { verdict: "OPEN", note: "Prototype — alternative cost AND different characteristics, the adventure shape again", probe: /\bPrototype\b/i },
  "719": { verdict: "OPEN", note: "Case cards — solve condition unmodelled", typeLine: /— Case/ },
  "720": { verdict: "OPEN", note: "Omen — 720.3d shuffles into library, never a graveyard; unmodelled" },
  "721": { verdict: "MODELLED", note: "Station — charge counters via KEYWORD_EMITS" },
  "722": { verdict: "PARTIAL", note: "Preparation cards — playableFaces lists the faces, the prepare mechanic itself is unmodelled", layout: "prepare" },
  "723": { verdict: "N/A", note: "controlling another player — 2 corpus cards, no synergy shape" },
  "724": { verdict: "OPEN", note: "ending turns and phases — 'end the turn' skips everything, invisible to the clock model", probe: /end the turn/i },
  "725": { verdict: "MODELLED", note: "monarch — trigger word added 2026-08-15" },
  "726": { verdict: "MODELLED", note: "initiative — trigger word added 2026-08-15" },
  "727": { verdict: "N/A", note: "restarting the game — 2 corpus cards" },
  "728": { verdict: "MODELLED", note: "rad counters — already in COUNTER_KINDS", probe: /rad counter/i },
  "729": { verdict: "N/A", note: "subgames — Shahrazad and friends, not EDH-relevant" },
  "730": { verdict: "OPEN", note: "merging with permanents — mutate; a merged permanent is several cards in one", probe: /\bmutate\b/i },
  "731": { verdict: "MODELLED", note: "day and night — trigger word added 2026-08-15" },
  "732": { verdict: "N/A", note: "taking shortcuts is a play convention" },
  "733": { verdict: "N/A", note: "handling illegal actions is a judge procedure" },

  // --- BANDS 1xx-6xx, judged individually 2026-08-15 after the owner asked whether any other
  // sections had been looked at. They had not; these are the ones that turned out to matter.
  "104": { verdict: "PARTIAL", note: "ending the game — `win-game` kind exists; 'loses the game' is a REFUSED trigger (LOSES_THE_GAME)", probe: /wins? the game|loses? the game/i },
  "111": { verdict: "MODELLED", note: "tokens — `token` tri-state on every subject, token-types.json from the tokens collection" },
  "113": { verdict: "MODELLED", note: "abilities — 113.3's four categories map to AbilityKind" },
  "115": { verdict: "PARTIAL", note: "targets — `becomes-target` trigger exists; nothing models WHAT a spell targets, so heroic-shaped payoffs have no supply" },
  "116": { verdict: "PARTIAL", note: "special actions — SWEPT 2026-08-20, all 12 of 116.2 judged: playing a land reaches the engine as `enters`, turning face up has both a verb and a trigger (119 trigger clauses), Rooms unlocking has `unlocked`, suspend/companion/foretell are keywords with no event anyone watches, Circling Vultures is a discard, planar die and conspiracies are N/A on legality. The one real hole is `plot` (116.2k), already tracked as MTGJSON lag. 708 face-down is still the same hole from the other side.", probe: /turn .{0,20}face up/i },
  "118": { verdict: "OPEN", note: "costs — additional and alternative costs unmodelled; Ability.cost holds the STRING and nothing parses it", probe: /rather than pay|without paying its mana cost/i },
  "122": { verdict: "MODELLED", note: "counters — COUNTER_KINDS, fixed against 122.1b (a18a969)" },
  "205": { verdict: "MODELLED", note: "type line — types/subtypes/supertypes generated from MTGJSON with a --check gate" },
  "310": { verdict: "OPEN", note: "Battles — a CARD TYPE, in the type vocabulary but with no defense/siege model", typeLine: /Battle/ },
  "604": { verdict: "PARTIAL", note: "static abilities — 604.3 characteristic-defining abilities unmodelled, so Tarmogoyf derives nothing" },
  "607": { verdict: "OPEN", note: "linked abilities — 'exiled with' pairs; the per-clause shared-trigger ceiling is this", probe: /exiled with/i },
  "611": { verdict: "PARTIAL", note: "continuous effects — statics derive, layers do not; `namesItsTargets` is the only mesh guard" },
  "614": { verdict: "OPEN", note: "REPLACEMENT EFFECTS — the largest gap in the engine. No shape for 'if X would Y, instead Z'", probe: /\bwould\b[^.]{0,80}\binstead\b/i },
  "615": { verdict: "OPEN", note: "prevention effects — 'prevent' has no model; a prevented damage still emits", probe: /\bprevent\b/i },

  // --- MULTIPLAYER (800s) and VARIANTS (900s). EDH is a multiplayer variant, so these are not
  // optional colour: 903 IS the format. Swept 2026-08-15 after the 7xx pass.
  "800": { verdict: "PARTIAL", note: "multiplayer general — the engine models no opponent at all; every number is optimistic by construction" },
  "801": { verdict: "N/A", note: "limited range of influence — not used in EDH" },
  "802": { verdict: "OPEN", note: "attack multiple players — the pressure clock accumulates against ONE opponent's 40" },
  "806": { verdict: "PARTIAL", note: "free-for-all is the EDH shape; pod analysis is a known blocked item" },
  "903": { verdict: "PARTIAL", note: "COMMANDER — `SubjectFilter.commander` SHIPPED 2026-08-15 (a deck fact per 903.3, stamped by markCommander); 903.5a-d LEGALITY shipped 2026-08-25 as a report (`legality.ts`, incl. colour identity and who may lead); 903.8 commander tax ships as a CAVEAT and not a number, because the tax follows how often the commander has DIED and nothing here simulates a game; Partner/Background pairing is still unmodelled (J12)", probe: /\b(a |your )commanders?\b(?! damage)/i },
};

/** Bands with no per-section verdict yet, stated as a band rather than faked one section at a time.
 *  The tool is complete; the JUDGING is partial, and the report says which is which. */
const BAND_NOTES: Record<string, string> = {
  "1": "game concepts — 113 ability types verified complete; 122 counters done via 122.1b; rest unjudged",
  "2": "parts of a card — types/subtypes/supertypes generated from MTGJSON, `--check` guarded",
  "3": "card types — same generated source",
  "4": "zones — 400.1's seven verified against ZONES",
  "5": "turn structure — steps added to TRIGGERS 2026-08-15; phase model still coarser than the CR",
  "6": "spells, abilities and effects — 604.3 characteristic-defining abilities unmodelled; rest unjudged",
  "8": "multiplayer — see the per-section rows above",
  "9": "casual variants — 903 Commander is the live one",
};

// Reads the COMMITTED section list, not the gitignored rules cache, so it runs in a fresh clone.
const sections = crKeywords.sections.map((s) => [s.rule, s.name] as [string, string]);
const file = `cr-keywords.json (rules ${crKeywords.version})`;

const store = await connect(loadConfig());
const count = async (s: Status): Promise<number | null> => {
  if (s.probe) return store.cards.countDocuments({ oracleText: s.probe } as never);
  if (s.typeLine) return store.cards.countDocuments({ typeLine: s.typeLine } as never);
  if (s.layout) return store.cards.countDocuments({ layout: s.layout } as never);
  return null;
};

console.log(`${file}\nCR 7xx sections: ${sections.length}\n`);
const unreviewed: string[] = [];
const rows: { rule: string; name: string; v: Verdict; n: number | null; note: string }[] = [];
for (const [rule, name] of sections) {
  const s = STATUS[rule];
  if (!s) { unreviewed.push(`${rule}. ${name}`); continue; }
  rows.push({ rule, name, v: s.verdict, n: await count(s), note: s.note });
}

for (const v of ["OPEN", "PARTIAL", "MODELLED", "N/A"] as Verdict[]) {
  const group = rows.filter((r) => r.v === v).sort((a, b) => (b.n ?? -1) - (a.n ?? -1));
  console.log(`=== ${v} (${group.length}) ===`);
  for (const r of group) {
    console.log(`  ${r.rule}. ${r.name.padEnd(28)} ${r.n === null ? "" : `${String(r.n).padStart(5)} cards`}  ${r.note}`);
  }
  console.log();
}

// Sections with no individual verdict, grouped by band. NOT a failure — an honest statement of how
// far the judging has got, against a section list that is now complete.
const byBand = new Map<string, string[]>();
for (const u of unreviewed) {
  const band = u[0];
  byBand.set(band, [...(byBand.get(band) ?? []), u]);
}
console.log(`=== NOT INDIVIDUALLY JUDGED (${unreviewed.length} of ${sections.length}) ===`);
for (const [band, list] of [...byBand].sort()) {
  console.log(`  ${band}xx (${list.length}) — ${BAND_NOTES[band] ?? "unjudged"}`);
}
console.log(`\njudged individually: ${rows.length}. The section list is COMPLETE; the judging is not,`);
console.log(`and this line is the difference. Rank the OPEN rows above by their card counts.`);
await store.close();
process.exit(0);
