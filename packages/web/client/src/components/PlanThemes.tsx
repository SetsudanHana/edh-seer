import { useMemo, useState } from "react";
import type { CardGraph, DeckReport } from "../types.js";
import { buildEngineModel, listNames, type EngineCard, type EngineGroup, type EngineModel } from "../lib/engine-model.js";
import { CardName, ReasonText } from "./card-drawer.js";
import { Art, Badge, CardFace, Lines, ReadCards, RepeatKey } from "./engine-parts.js";

/** WHAT THE DECK DOES, IN THE GAME PLAN CHAPTER (owner, 2026-09-26: "it does not make any sense to
 *  have 2 times the same report"). The Graph tab's Overview grew into a second report beside this
 *  one; its themes and best pairs move here, where the report already asks what the plan is.
 *
 *  THE CARDS LEAD (appeal review 2026-09-26). The designer's words for the Overview's groups were
 *  "a wall of chips and text"; each theme now leads with its key cards as card images, and the
 *  rest of its cards sit behind "Show all". "See links" opens the card's orbit over the report,
 *  where its links can be followed; the card's image opens the card itself, as everywhere in the
 *  report. */
export function PlanThemes({ report, graph, model, onOpenCard }: {
  report: DeckReport; graph: CardGraph;
  /** The engine model, when the caller already built it to decide whether to show this at all. */
  model?: EngineModel;
  /** Opens a card's orbit over the report. */
  onOpenCard?: (id: string) => void;
}) {
  const m = useMemo(() => model ?? buildEngineModel(report, graph), [model, report, graph]);
  // A group that mostly repeats another goes after the ones that do not, so the few shown first are
  // the deck's different things (Overview round 9: four Inalla groups in a row were the same Wizards).
  const themes = m.groups.filter((g) => !g.helper).sort((x, y) => Number(!!x.sameAs) - Number(!!y.sameAs));
  const helpers = m.groups.filter((g) => g.helper);
  const [allThemes, setAllThemes] = useState(false);
  const [showHelpers, setShowHelpers] = useState(false);
  const shown = allThemes ? themes : themes.slice(0, THEME_CAP);
  const more = themes.slice(THEME_CAP);
  if (!m.totalLinks) return null;
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="plan-themes" className="flex flex-col gap-3">
        <h3 id="plan-themes" className="text-lg font-semibold">What your deck does</h3>
        <p className="max-w-[70ch] text-sm text-(--muted)">
          {/* "6 things, listed below" over three shown read as a miscount (Overview round 12). */}
          It mostly does <b className="text-(--foreground)">{themes.length} thing{themes.length === 1 ? "" : "s"}</b>
          {more.length ? <>; the {allThemes ? "" : `${shown.length} biggest `}are below</> : ""}. Each shows the cards
          that do something extra, then the cards that set them off. Tap a card to see everything it works with.
        </p>
        <div className="flex flex-col gap-3">
          {shown.map((g) => <Theme key={g.tag} g={g} m={m} onOpenCard={onOpenCard} />)}
        </div>
        {more.length ? (
          <p>
            <button type="button" className="min-h-11 rounded-(--radius) border border-(--separator) px-4 text-sm" onClick={() => setAllThemes(!allThemes)}>
              {allThemes ? "Show fewer" : `Show ${more.length} more: ${listNames(more.map((g) => g.name.toLowerCase()), 4)}`}
            </button>
          </p>
        ) : null}
        {helpers.length ? (
          <div className="flex flex-col gap-3">
            {/* Folded: useful, not a plan, and every Overview seat stopped scrolling above them. */}
            {showHelpers ? helpers.map((g) => <Theme key={g.tag} g={g} m={m} onOpenCard={onOpenCard} />) : null}
            <p className="text-sm text-(--muted)">
              <button type="button" className="mr-2 min-h-11 rounded-(--radius) border border-(--separator) px-4 text-(--foreground)" onClick={() => setShowHelpers(!showHelpers)}>
                {showHelpers ? "Hide the helpers" : `Show the helpers: ${listNames(helpers.map((g) => g.name.toLowerCase()), 4)}`}
              </button>
              Cards that make many others cheaper, give them types, or find them: useful, but not a plan on their own.
            </p>
          </div>
        ) : null}
      </section>

      {m.strongest.length ? (
        <section aria-labelledby="plan-pairs" className="flex flex-col gap-3">
          <h3 id="plan-pairs" className="text-lg font-semibold">The pairs that work best together</h3>
          <p className="max-w-[70ch] text-sm text-(--muted)">Ranked by how many different ways they help each other, whether it goes both ways and keeps happening, and how central both cards are.</p>
          <RepeatKey />
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,22rem),1fr))]">
            {m.strongest.map(({ pair, ways, both, lines }) => {
              const a = m.cards.get(pair.a)!, b = m.cards.get(pair.b)!;
              return (
                <article key={`${pair.a}|${pair.b}`} className="flex flex-col gap-3 rounded-(--radius) border border-(--separator) bg-(--surface) p-3 text-sm">
                  <div className="flex items-start gap-4">
                    <span className="flex shrink-0 pt-1 pl-1">
                      <CardFace card={a} className="w-20 -rotate-3 sm:w-28" />
                      <CardFace card={b} className="-ml-6 mt-3 w-20 rotate-3 sm:-ml-8 sm:w-28" />
                    </span>
                    <div className="flex min-w-0 flex-col gap-1">
                      <h4 className="text-base font-semibold"><CardName name={a.name} /> + <CardName name={b.name} /></h4>
                      <p className="text-(--muted)">{both ? "Each helps the other" : "One helps the other"}, {ways.length === 1 ? "in one way" : `in ${ways.length} ways`}: {ways.map((w) => w.toLowerCase()).join("; ")}.</p>
                    </div>
                  </div>
                  <Lines links={lines} />
                  <ReadCards cards={[a, b]} />
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** How many themes show before "Show N more": the Overview's six ran to ten phone screens. */
const THEME_CAP = 3;
/** Key cards shown as images before the row scrolls; cards that set them off shown as chips. */
const MEMBER_CAP = 10;

const byWeight = (a: EngineCard, b: EngineCard) => Number(b.isCommander) - Number(a.isCommander) || b.score - a.score || (a.name < b.name ? -1 : 1);

/** One theme as a hero row: its name and size, the key cards as images, the cards that set them
 *  off as chips behind "Show all", and one example line to check it by. */
function Theme({ g, m, onOpenCard }: { g: EngineGroup; m: EngineModel; onOpenCard?: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const hubs = g.hubs.map((id) => m.cards.get(id)!).sort(byWeight);
  const hubSet = new Set(g.hubs);
  // The cards that set them off, without repeating the key cards above (appeal review: "the same
  // names two or three times").
  const members = g.members.filter((id) => !hubSet.has(id)).map((id) => m.cards.get(id)!)
    .sort((a, b) => Number(g.onceOnly.has(a.id)) - Number(g.onceOnly.has(b.id)) || byWeight(a, b));
  const shownMembers = all ? members : members.slice(0, MEMBER_CAP);
  const open = (c: EngineCard) => onOpenCard?.(c.id);
  const hubWord = g.helper
    ? (hubs.length === 1 ? "This card helps" : `These ${hubs.length} cards help`)
    : (hubs.length === 1 ? "This card does something extra" : `These ${hubs.length} cards do something extra`);
  const memberWord = g.helper ? "the cards they help" : "when one of these is involved";
  return (
    <article className="flex flex-col gap-3 rounded-(--radius) border border-(--separator) bg-(--surface) p-4" aria-labelledby={`theme-${g.tag}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span aria-hidden="true" className="h-3 w-3 shrink-0 self-center rounded-full" style={{ background: g.hue }} />
        <h4 id={`theme-${g.tag}`} className="text-base font-semibold">{g.name}</h4>
        <span className="text-sm text-(--muted)">
          {new Set([...g.hubs, ...g.members]).size} cards · {g.repeating} pair{g.repeating === 1 ? "" : "s"} that keep working{g.once ? `, ${g.once} once` : ""}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm text-(--muted)">{hubWord}…</span>
        <ul className="flex gap-2 overflow-x-auto pb-1 snap-x" aria-label={`${g.name}: key cards`}>
          {hubs.map((c) => (
            <li key={c.id} className="flex w-[84px] shrink-0 snap-start flex-col items-center gap-1 sm:w-[96px]">
              <CardFace card={c} className="w-full" />
              {onOpenCard ? (
                <button type="button" className="min-h-8 w-full truncate rounded-(--radius) px-1 text-xs text-(--muted) hover:text-(--foreground)" onClick={() => open(c)} aria-label={`See what ${c.name} works with`}>
                  See links
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
      {members.length ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-(--muted)">…{memberWord}: {members.length} card{members.length === 1 ? "" : "s"}{g.sameAs ? <>, mostly the same as <b className="text-(--foreground)">{g.sameAs.name}</b></> : null}</span>
          <div className="flex flex-wrap gap-1.5">
            {shownMembers.map((c) => (
              <button key={c.id} type="button" onClick={() => open(c)} disabled={!onOpenCard}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-sm ${g.onceOnly.has(c.id) ? "border-dashed text-(--muted)" : "border-(--separator)"} enabled:hover:border-(--foreground)`}
                title={g.onceOnly.has(c.id) ? "Works with this theme only once" : undefined}>
                <Art card={c} size={24} />
                {c.name.split(" // ")[0]}{c.isToken ? <span className="font-normal text-(--muted)"> (token)</span> : null}
              </button>
            ))}
            {members.length > MEMBER_CAP ? (
              <button type="button" className="min-h-9 rounded-full border border-(--separator) px-3 text-sm" onClick={() => setAll(!all)}>
                {all ? "Show fewer" : `Show all ${members.length}`}
              </button>
            ) : null}
          </div>
          {g.onceOnly.size ? <span className="text-xs text-(--muted)">A dashed outline works with this theme only once.</span> : null}
        </div>
      ) : null}
      {g.example ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-(--muted)">For example: <Badge repeat={g.example.repeat} /><ReasonText text={g.example.text} /></summary>
          <div className="mt-2 flex items-start gap-3">
            <span className="flex shrink-0">
              <CardFace card={m.cards.get(g.example.from)!} className="w-16 sm:w-20" />
              <CardFace card={m.cards.get(g.example.to)!} className="-ml-4 mt-2 w-16 sm:w-20" />
            </span>
            <ReadCards cards={[m.cards.get(g.example.from)!, m.cards.get(g.example.to)!]} />
          </div>
        </details>
      ) : null}
    </article>
  );
}
