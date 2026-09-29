import type { ReactNode } from "react";
import { CHAPTERS, type ChapterId } from "../lib/chapters.js";
import type { DeckReport } from "../types.js";
import { mainTheme } from "../lib/main-theme.js";
import { WIN_PHRASE } from "@edh-seer/matcher/deck-sentence";

/** WHAT THE RAIL SAYS FOR EACH CHAPTER (owner, 2026-09-29, drawer option B: "which has by default
 *  those information and changes between chapters").
 *
 *  THE RAIL IS NEVER EMPTY, which is what makes it keepable. A reserved column that waits for a
 *  click is the Empty Band `DESIGN.md` names; one that always says where the reader is, and what
 *  this chapter comes down to, earns its 20rem. Every summary is ONE SLOT, all six mounted and only
 *  the current one shown, so nothing on the page or in the rail re-mounts as the reader scrolls.
 *
 *  NUMBERS THE CHAPTER ALREADY PRINTS, NEVER NEW ONES: a summary that computed its own figure would
 *  be a second place for one fact to disagree with itself. Glance is the exception by design -- its
 *  slot is where the map's own column (theme, key, centred card) is portalled, see `OrbitView`. */
export function ReportRailSummaries({ current, report, cutCount, readSlot }: {
  current: ChapterId;
  report: DeckReport;
  /** The cut list's length, which the report chooses (`chooseCuts`) and the rail only counts. */
  cutCount: number;
  /** Receives the Glance slot's element, for `OrbitView` to portal its column into. */
  readSlot: (el: HTMLElement | null) => void;
}) {
  const slot = (id: ChapterId, body: ReactNode) => (
    <section key={id} aria-label={CHAPTERS.find((c) => c.id === id)!.title} hidden={current !== id}
      data-testid={`rail-${id}`} className="flex flex-col gap-4">
      {body}
    </section>
  );
  return (
    <>
      {/* THE CHAPTER'S NAME IS THE HEADING, not a kicker: every summary below opens with rows or
        *  the theme's own label, and a kicker over a kicker is the stack DESIGN.md forbids. */}
      <h2 className="text-xl font-bold tracking-[-0.01em]">{CHAPTERS.find((c) => c.id === current)!.title}</h2>
      <section aria-label="Deck at a glance" hidden={current !== "read"} data-testid="rail-read">
        <div ref={readSlot} />
      </section>
      {slot("stand", <Scores report={report} />)}
      {slot("plan", <Plan report={report} />)}
      {slot("mana", <Mana report={report} />)}
      {slot("roles", <Roles report={report} />)}
      {slot("fix", <Improve report={report} cutCount={cutCount} />)}
      <p className="text-sm text-(--muted)">Pick any card to read it here.</p>
    </>
  );
}

const Row = ({ label, value }: { label: ReactNode; value: ReactNode }) => (
  <div className="flex items-baseline justify-between gap-3 border-b border-(--separator) pb-2 text-sm">
    <span className="min-w-0">{label}</span>
    {/* THE FIGURE STAYS WHOLE; THE LABEL WRAPS (designer review 2026-09-29: "8 / cards"). */}
    <span className="text-(--muted) tabular-nums text-right whitespace-nowrap">{value}</span>
  </div>
);

function Scores({ report }: { report: DeckReport }) {
  const band = report.bracket?.band;
  return (
    <div className="flex flex-col gap-2">
      {report.synergyOverall !== undefined ? <Row label="Synergy" value={`${report.synergyOverall.toFixed(1)} / 5`} /> : null}
      {report.buildScore !== undefined ? <Row label="Build" value={`${report.buildScore.toFixed(1)} / 5`} /> : null}
      {band ? <Row label="Bracket" value={band} /> : null}
      {report.bracket?.reasons.slice(0, 2).map((r) => <p key={r} className="text-sm text-(--muted)">{r}</p>)}
    </div>
  );
}

function Plan({ report }: { report: DeckReport }) {
  const main = mainTheme(report);
  const classes = [...(report.deckMath?.wincons.classes ?? [])].sort((a, b) => b.count - a.count).slice(0, 3);
  const clock = report.deckMath?.clock.turn;
  return (
    <div className="flex flex-col gap-2">
      {main ? <Row label="Main theme" value={main.name} /> : null}
      {classes.map((c) => <Row key={c.class} label={`Wins by ${WIN_PHRASE[c.class] ?? c.class}`} value={`${c.count} ${c.count === 1 ? "card" : "cards"}`} />)}
      {clock !== undefined ? <Row label="Creatures alone could win by" value={`turn ${clock}`} /> : null}
    </div>
  );
}

function Mana({ report }: { report: DeckReport }) {
  const lands = report.deckMath?.lands;
  if (!lands) return null;
  const off = lands.actual - lands.target;
  return (
    <div className="flex flex-col gap-2">
      <Row label="Lands" value={`${lands.actual}, wants ${lands.target}`} />
      <p className="text-sm text-(--muted)">
        {off === 0 ? "Right on target." : `${Math.abs(off)} ${off > 0 ? "over" : "under"}${Math.abs(off) <= 3 ? ", within the normal ±3" : ""}.`}
      </p>
      {lands.avgManaValue !== undefined ? <Row label="Average mana value" value={lands.avgManaValue.toFixed(2)} /> : null}
    </div>
  );
}

function Roles({ report }: { report: DeckReport }) {
  const parents = report.buildParents ?? [];
  if (parents.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {parents.map((p) => <Row key={p.name} label={p.name} value={`${p.count} of ${p.target}`} />)}
    </div>
  );
}

function Improve({ report, cutCount }: { report: DeckReport; cutCount: number }) {
  const over = report.slack ?? [];
  return (
    <div className="flex flex-col gap-2">
      <Row label="Possible cuts" value={cutCount} />
      {over.map((s) => <Row key={s.category} label={`${s.category} over its target`} value={`by ${s.over}`} />)}
    </div>
  );
}
