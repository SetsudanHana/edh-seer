import { effectPhrase, type AbilityRow } from "@edh-seer/matcher/partners-core";
import { eventKeySentence } from "../lib/demand-sentence.js";

/** HOW THE ENGINE READ THIS CARD, one row per derived ability.
 *
 *  THE PAGE'S REAL ARGUMENT, and it was missing. The card page printed the UNION of a card's events
 *  -- two flat lines standing in for three abilities -- so a reader checking a claim could not see
 *  WHICH ability produced it. Krenko's tap ability and the fact that he is himself a Goblin are two
 *  different reasons his page lists a Goblin, and the difference is the whole question when a claim
 *  looks wrong.
 *
 *  IT PUBLISHES OUR DERIVATION AND NOT WIZARDS' TEXT, which is why it may exist where a printed
 *  rules box may not (spec D2, reversed). The card's own words are on the image beside it, which is
 *  also where the artist is credited.
 *
 *  A TABLE, DELIBERATELY. DESIGN.md scopes real `<table>` markup to inventories and bans it on the
 *  reading screens where a reason sentence is the atomic unit -- this is the first: four fixed
 *  columns, one row per ability, read down and across. The partner list one section below is the
 *  second, and stays prose. */
const KIND_LABEL: Record<string, string> = {
  triggered: "triggered",
  activated: "activated",
  static: "static",
  "on-cast": "on cast",
};

export function AbilityTable({ rows }: { rows: AbilityRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          {/* THE HEADER RULE IS HEAVIER THAN THE ROW RULES, which is DESIGN.md's table spec -- but
            * it names `--border`, and that token does not exist: it was absorbed into `--separator`
            * because two tokens were doing one job. `--field-border` is the structural weight the
            * system actually has, and `css-tokens.test.ts` caught the first cut naming the ghost. */}
          <tr className="border-b border-(--field-border)">
            <th scope="col" className="eyebrow text-(--muted) py-2 pr-4 align-bottom">kind</th>
            <th scope="col" className="eyebrow text-(--muted) py-2 pr-4 align-bottom">when</th>
            <th scope="col" className="eyebrow text-(--muted) py-2 pr-4 align-bottom">what it does</th>
            <th scope="col" className="eyebrow text-(--muted) py-2 align-bottom">puts into the game</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a, i) => (
            <tr key={i} className="border-b border-(--separator) align-top">
              <td className="py-3 pr-4">
                <span className="eyebrow text-(--muted)">{KIND_LABEL[a.kind] ?? a.kind}</span>
                {/* THE COST IS PART OF "HOW IT FIRES", not a separate fact: an activated ability
                  * with no cost shown is an ability a reader cannot judge the speed of. */}
                {a.cost && <span className="block font-mono text-sm mt-1">{a.cost}</span>}
              </td>
              <td className="py-3 pr-4">
                {a.when.length === 0
                  ? <span className="text-(--muted)">—</span>
                  : <ul className="flex flex-col gap-1">
                      {a.when.map((w) => <li key={w}>{eventKeySentence(w)}</li>)}
                    </ul>}
              </td>
              <td className="py-3 pr-4">
                {effectPhrase(a.effect, a.amount) ?? a.effect.replace(/-/g, " ") ?? "—"}
                {/* A MAGNITUDE THAT COUNTS SOMETHING SAYS WHAT IT COUNTS. "per-permanent" alone is a
                  * word with no object, and the count is the whole reason a Goblin deck runs this. */}
                {a.counts && (
                  <span className="block text-(--muted) text-sm mt-1">
                    once for every {a.counts.charAt(0).toUpperCase() + a.counts.slice(1)} you control
                  </span>
                )}
              </td>
              <td className="py-3">
                {a.emits.length === 0
                  ? <span className="text-(--muted)">—</span>
                  : <ul className="flex flex-col gap-1">
                      {a.emits.map((e) => <li key={e}>{eventKeySentence(e)}</li>)}
                    </ul>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
