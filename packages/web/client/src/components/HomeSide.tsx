import { useEffect, useMemo, useState, type RefObject } from "react";
import { Link } from "react-router";
import { parseDecklistSections } from "@edh-seer/data/sections";
import { parseDecklistText } from "@edh-seer/data/decklist";
import { normalizeName } from "@edh-seer/data/names";
import { deckSourceOf } from "@edh-seer/data/deck-url";
import { StaticLookup } from "@edh-seer/matcher/static-lookup";
import { loadPrecon, loadPreconIndex, preconDecklist } from "../lib/precons.js";
import type { PreconIndexEntry } from "../lib/precon-html.js";
import { PRECON_TILE, PreconTileBody } from "./PreconIndex.js";

import { Arrow } from "./icons.js";
/** THE HOME PAGE'S THIRD COLUMN (owner, 2026-09-30, #770: mockup A of "Home page at 2K/4K").
 *
 *  From 1600px the home page is pitch | paste box | this. With nothing pasted it offers a place to
 *  start for a reader with no list to hand: a precon they own, whose list goes in the box, or the
 *  commanders. With a list in the box it reads the list back, found cards filled and lines that
 *  are not found dashed, by the same parser and the same resolver the report uses -- so "not
 *  found" here is exactly the line the report will leave out, never a guess of this panel's own.
 *
 *  Below 1600px it is not drawn: the paste box keeps its row, as it always did. */
export function HomeSide({ commanders, decklist, onPick }: {
  commanders: string;
  decklist: string;
  /** Put a list in the box, as "Try an example" does. */
  onPick: (commanders: string, decklist: string) => void;
}) {
  return (
    <div className="home-side relative hidden min-[100rem]:block" aria-label={decklist.trim() ? "What we read" : "Where to start"} role="region">
      {/* THE BOX SETS THE ROW'S HEIGHT, NOT THIS: a read-back of a hundred cards would push the
        *  buttons off the screen, so the column scrolls inside the height the paste box gives it. */}
      <div className="absolute inset-0 overflow-y-auto overscroll-contain pr-2">
        {decklist.trim() ? <ReadBack commanders={commanders} decklist={decklist} /> : <StartFrom onPick={onPick} />}
      </div>
    </div>
  );
}

/** How many precons the start column offers; the rest are one link away. */
const START_PRECONS = 12;

function StartFrom({ onPick }: { onPick: (commanders: string, decklist: string) => void }) {
  const [precons, setPrecons] = useState<PreconIndexEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadPreconIndex().then((list) => { if (live) setPrecons(list ?? []); }, () => { if (live) setPrecons([]); });
    return () => { live = false; };
  }, []);
  // THE NEWEST FIRST, ONE OF EACH: a collector's edition is the same deck twice.
  const shown = useMemo(() => (precons ?? [])
    .filter((p) => !/collector'?s edition/i.test(p.name))
    .slice()
    .sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "") || a.name.localeCompare(b.name))
    .slice(0, START_PRECONS), [precons]);
  const pick = async (slug: string) => {
    setBusy(slug);
    try {
      const rec = await loadPrecon(slug);
      if (rec) onPick(rec.page.commanders.join("\n"), preconDecklist(rec.page));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h2 className="t-section">Start from a precon you own</h2>
        <p className="max-w-[60ch] text-sm text-(--muted)">Pick yours and its list goes in the box, ready to change.</p>
      </div>
      {precons === null ? <p role="status" className="text-sm text-(--muted)">Loading the precons</p> : (
        <ul className="grid list-none gap-2.5 p-0 m-0 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]" aria-label="Recent precons">
          {shown.map((p) => (
            <li key={p.slug}>
              <button type="button" disabled={busy !== null} aria-busy={busy === p.slug} onClick={() => void pick(p.slug)}
                className={`${PRECON_TILE} hover:border-(--foreground) disabled:opacity-60`}>
                <PreconTileBody d={p} />
                {/* THE TILE SAYS WHAT IT DOES (#1003): the /precons tile with the same box opens the
                  *  precon's page; this one puts its list in the box beside it. */}
                <span className="eyebrow text-(--accent) mt-1">Load its list</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Link to="/precons" className="self-start text-sm text-(--accent) hover:underline inline-flex items-center gap-1">Every precon <Arrow dir="right" /></Link>
      <div className="flex flex-col gap-1.5 border-t border-(--separator) pt-5">
        <h2 className="t-section">Or build around a commander</h2>
        <p className="max-w-[60ch] text-sm text-(--muted)">What a commander wants, and the cards that work with it most.</p>
        <Link to="/commanders" className="self-start text-sm text-(--accent) hover:underline inline-flex items-center gap-1">Browse commanders <Arrow dir="right" /></Link>
      </div>
    </div>
  );
}

/** How long the read-back waits after the last keystroke; a paste settles at once. */
const READ_SETTLE_MS = 400;

/** THE LIST AS THE REPORT WILL READ IT: `parseDecklistSections` and `parseDecklistText`, as
 *  `analyzeDecklist` calls them, then each name through the same `/static` lookup. */
export async function readBack(commanders: string, decklist: string, lookup: Pick<StaticLookup, "prefetch" | "findByName">): Promise<{ commanders: string[]; found: string[]; missing: string[]; cards: number }> {
  const sections = parseDecklistSections(decklist);
  const commanderNames = commanders.trim() ? parseDecklistText(commanders) : sections.commanders;
  const names = [...commanderNames, ...sections.deck];
  // NORMALISED FOR THE PREFETCH, as `analyzeDecklist` hands them to its sources.
  await lookup.prefetch(names.map(normalizeName));
  const found: string[] = [];
  const missing: string[] = [];
  for (const n of names) {
    const doc = await lookup.findByName(normalizeName(n));
    if (doc) found.push(doc.name); else missing.push(n);
  }
  return { commanders: commanderNames, found, missing: [...new Set(missing)], cards: found.length };
}

function ReadBack({ commanders, decklist }: { commanders: string; decklist: string }) {
  const lookup = useMemo(() => new StaticLookup("/static"), []);
  const [read, setRead] = useState<Awaited<ReturnType<typeof readBack>> | null>(null);
  const link = deckSourceOf(decklist) !== null;
  useEffect(() => {
    if (link) return;
    let live = true;
    const t = setTimeout(() => {
      readBack(commanders, decklist, lookup).then((r) => { if (live) setRead(r); }, () => { if (live) setRead(null); });
    }, READ_SETTLE_MS);
    return () => { live = false; clearTimeout(t); };
  }, [commanders, decklist, lookup, link]);
  if (link) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="eyebrow text-(--muted)">What we read</span>
        <h2 className="t-section">A deck link</h2>
        <p className="max-w-[60ch] text-sm text-(--muted)">Its list is fetched when you analyse the deck.</p>
      </div>
    );
  }
  if (!read) return <p role="status" aria-busy="true" className="text-sm text-(--muted)">Reading your list</p>;
  const unique = [...new Set(read.found)];
  return (
    <div className="flex flex-col gap-4" data-testid="read-back">
      <div className="flex flex-col gap-1.5">
        <span className="eyebrow text-(--muted)">What we read</span>
        <h2 className="t-section" aria-live="polite">
          {read.cards} {read.cards === 1 ? "card" : "cards"} found{read.commanders.length ? ` for ${read.commanders.join(" and ")}` : ""}
          {read.missing.length ? `, ${read.missing.length} ${read.missing.length === 1 ? "line" : "lines"} not` : ""}
        </h2>
        {read.missing.length ? (
          <p className="max-w-[60ch] text-sm text-(--muted)">Lines we can&rsquo;t match to a card are left out of the report. Fix a line in the box and it is read again.</p>
        ) : null}
      </div>
      {read.missing.length ? (
        <ul className="flex list-none flex-wrap gap-2 p-0 m-0" aria-label="Lines not found">
          {read.missing.map((m) => (
            <li key={m} className="rounded-(--radius) border border-dashed border-(--accent) px-3 py-1 text-sm">{m}</li>
          ))}
        </ul>
      ) : null}
      <ul className="grid list-none gap-1.5 p-0 m-0 [grid-template-columns:repeat(auto-fill,minmax(12rem,1fr))]" aria-label="Cards found">
        {unique.map((n) => (
          <li key={n} className="truncate rounded-(--radius) border border-(--separator) bg-(--surface) px-3 py-1 text-xs" title={n}>{n}</li>
        ))}
      </ul>
    </div>
  );
}

/** THE INTRO'S EVIDENCE, BESIDE THE CLAIM IT BACKS (mockup A): from 1600px the static intro's
 *  figures and its worked pairing move up into the pitch column, and back when the pitch goes or
 *  the screen narrows. MOVED, NOT COPIED: those numbers live once, in `index.html`, where a crawler
 *  that runs no JavaScript reads them, and a second copy here is a second place to keep in step.
 *  The intro sits below the fold at that width, so taking them out of it shifts nothing on screen. */
export function useIntroLift(slot: RefObject<HTMLElement | null>, active: boolean): void {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.("(min-width: 100rem)").matches);
  useEffect(() => {
    const mq = window.matchMedia?.("(min-width: 100rem)");
    if (!mq) return;
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  useEffect(() => {
    const target = slot.current;
    if (!active || !wide || !target) return;
    const figures = document.querySelector<HTMLElement>(".intro > .figures");
    const demo = document.querySelector<HTMLElement>(".intro > .edge-demo");
    const heading = demo?.previousElementSibling?.tagName === "H2" ? demo.previousElementSibling as HTMLElement : null;
    const nodes = [figures, heading, demo].filter((n): n is HTMLElement => !!n);
    const homes = nodes.map((n) => ({ n, parent: n.parentNode!, next: n.nextSibling }));
    for (const n of nodes) target.appendChild(n);
    return () => {
      // Back in reverse, so each one's remembered neighbour is already in place.
      for (const { n, parent, next } of homes.reverse()) parent.insertBefore(n, next && next.parentNode === parent ? next : null);
    };
  }, [active, wide, slot]);
}
