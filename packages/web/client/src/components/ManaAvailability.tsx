import type { DeckReport } from "../types.js";
import { policyBand } from "@edh-seer/engine/percent";

/** MANA AVAILABILITY — a seeded goldfish simulation, not a formula (roadmap I11's report wiring).
 *
 *  AN INTERVAL AND NEVER A POINT, because the model's own falsifier fired before this panel existed:
 *  policy sensitivity measured 27.6pp against a 32.7pp median ramp signal, so mana availability is a
 *  POLICY property at deck scale. The headline shows both ends or it shows nothing.
 *
 *  THE PER-TURN ROWS ARE NOT A SECOND INTERVAL, and that is a finding rather than a shortcut: the
 *  two policies agree on every median and disagree only in the tail. A per-row policy range would
 *  print "15% – 15%" eight times and hide the sensitivity where nobody looks.
 *
 *  NOT THE PER-CARD CASTABILITY FIGURE. That one is colour-aware and counts lands; this is
 *  colour-blind and models ramp and tapped lands. Neither contains the other, and the measured fact
 *  is that castability's interval does not contain this answer on a green land-ramp deck — which is
 *  why `DeckIdentity` names this number rather than leaving a reader to pick. */
export function ManaAvailability({ manaAvailability }: { manaAvailability: DeckReport["manaAvailability"] }) {
  if (!manaAvailability || manaAvailability.rows.length === 0) return null;
  const m = manaAvailability;
  const pct = (v: number): string => `${Math.round(v * 100)}%`;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="eyebrow">Mana availability</h3>
      <div className="flex items-baseline gap-3">
        {/* ONE FIGURE WHEN THE TWO POLICIES AGREE, never "100% – 100%". The precedent is
          *  `castability.ts`'s own range, which collapses on 18.9% of rows and prints a single
          *  number there: a range whose ends are equal is not a range, and printing it as one makes
          *  a reader look for a difference that is not there. */}
        <span className="stat-num text-2xl">
          {policyBand(m.headline.low, m.headline.high)}
        </span>
        <span className="text-xs text-(--muted)">
          to make {m.headline.mana} mana by turn {m.headline.turn}
        </span>
      </div>
      <p className="text-sm text-(--muted)">
        {m.trials.toLocaleString()} simulated games, {m.accelerants} accelerants in the deck. The range is
        the <strong>play policy</strong>: the low end holds up two mana, the high end spends everything
        on acceleration and is a ceiling no real deck plays to.
      </p>

      <table className="text-xs tabular-nums w-full">
        <thead className="text-(--muted)">
          <tr>
            <th className="text-left font-normal py-1">turn</th>
            <th className="text-left font-normal py-1">mana</th>
            <th className="text-left font-normal py-1">spells you could pay for</th>
          </tr>
        </thead>
        <tbody>
          {m.rows.map((r) => (
            <tr key={r.turn} className="border-t border-(--separator)">
              <td className="py-1 stat-num">{r.turn}</td>
              {/* THE SPREAD BESIDE EVERY MEDIAN, never the median alone — a distribution shown as one
                *  number invites the reader to treat it as certain. */}
              <td className="py-1">
                <span className="stat-num">{r.mana.median}</span>
                <span className="text-(--muted)"> ({r.mana.p25}–{r.mana.p75})</span>
              </td>
              <td className="py-1">
                <span className="stat-num">{pct(r.payableShare.median)}</span>
                <span className="text-(--muted)"> ({pct(r.payableShare.p25)}–{pct(r.payableShare.p75)})</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-xs text-(--muted)">
        Rows are the spend-everything policy, median with p25–p75 beside it. Colour is ignored
        entirely, so this is <strong>mana</strong> and never castability — a {"{3}{R}{G}{W}"} spell
        needs three specific colours nothing here checks.
      </p>
    </div>
  );
}
