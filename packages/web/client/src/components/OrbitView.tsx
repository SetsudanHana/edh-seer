import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { CardGraph, DeckReport } from "../types.js";
import { buildEngineModel, displayName, tokenLabel, type EngineCard, type EngineModel } from "../lib/engine-model.js";
import { mainTheme } from "../lib/main-theme.js";
import { buildOrbit, countText, type OrbitModel, type OrbitPartner, type OrbitSector } from "../lib/orbit-model.js";
export { countText };
import { slugOf } from "@edh-seer/matcher/slug";
import { ReasonText, useCardDrawer } from "./card-drawer.js";
import { allPartners, Constellation, type MenuItem } from "./Constellation.js";
import { Art, Badge, CardFace, Lines, ReadCards, RepeatKey, useNarrow } from "./engine-parts.js";

/** THE ONE-CARD VIEW AS AN ORBIT (graph evaluation 2026-09-25, design B; replaces `EgoView`).
 *
 *  The focus sits in the middle of a map (`Constellation`), the cards it works with around it in
 *  their group's colour, a solid line for a link that keeps working and a dashed one for a link
 *  that works once; cards already walked through keep their place. The panel beside it
 *  says what the picture can't: the sentences, both cards' text, and the rest of the deck, as the
 *  cards one step further out and the ones that don't reach the focus at all.
 *
 *  A TAP READS, A SECOND TAP MOVES: the rule `EgoView` settled on, so a mis-aimed tap never throws
 *  the reader somewhere else. Where they have been is the gold route on the map, and the card they
 *  came from is a button at the top of the panel. */
export function OrbitView({ report, graph, focusId, onFocus, model, sticky = true, lead }: {
  report: DeckReport; graph: CardGraph;
  focusId: string;
  onFocus: (id: string) => void;
  /** The engine model, when the caller already built it. */
  model?: EngineModel;
  /** The panel keeps its place beside the ring while the page scrolls. Off inside the overlay,
   *  which is one screen tall and scrolls on its own. */
  sticky?: boolean;
  /** THE REPORT'S FIRST SCREEN (Glance mockup, 2026-09-27): what leads the column beside the map,
   *  the deck's theme, over the map's key. With it the key sits left of the map, as drawn, and on a
   *  phone the order is this, the map, then the key. */
  lead?: React.ReactNode;
}) {
  const m = useMemo(() => model ?? buildEngineModel(report, graph), [model, report, graph]);
  const o = useMemo(() => {
    const built = buildOrbit(m, focusId);
    // THE NAMED THEMES BY ONE NAME (appeal review 2026-09-26): their groups take the names Glance
    // and Scores give them.
    const main = mainTheme(report);
    if (built && main) {
      for (const s of built.sectors) {
        if (s.key === main.tag) s.name = main.name;
        else if (main.second && s.key === main.second.tag) s.name = main.second.name;
      }
    }
    return built;
  }, [m, focusId, report]);
  const narrow = useNarrow();
  const [sel, setSel] = useState<string | null>(null);
  const [sector, setSector] = useState<string | null>(null);
  // THE PAIR BOX OPENS ONLY WHEN ASKED FOR (owner, 2026-09-27): a tap opens the card drawer, and the
  // box beside it said less; it stays for "How it works with…" and a card picked from a group.
  const [pair, setPair] = useState<string | null>(null);
  const [trail, setTrail] = useState<string[]>([]);
  // THE PATH FOLLOWS THE MIDDLE, WHOEVER MOVED IT (demo recording, 2026-09-27): the drawer's "Walk
  // the map from here" sets the middle from outside, and the path stayed empty after it. A card
  // already on the path is a step back to it; any other is a step on.
  const [seen, setSeen] = useState(focusId);
  if (seen !== focusId) {
    setSeen(focusId);
    const i = trail.indexOf(focusId);
    setTrail(i >= 0 ? trail.slice(0, i) : [...trail, seen].slice(-6));
  }
  const still = useReducedMotion();
  const [paused, setPaused] = usePaused();
  const [hover, setHover] = useState<string | null>(null);
  const drawer = useCardDrawer();
  useEffect(() => { setSel(null); setPair(null); setSector(null); setHover(null); }, [focusId]);
  // ON A PHONE THE PANEL IS UNDER THE RING, a screen down: a tapped card changed a panel nobody
  // could see, and two phone seats tapped again thinking the tap was lost (appeal review
  // 2026-09-26). The panel comes up to meet the tap.
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!narrow || sector === null) return;
    panel.current?.scrollIntoView?.({ block: "nearest", behavior: still ? "auto" : "smooth" });
  }, [sector, narrow, still]);
  if (!o) return null;

  const centre = (id: string) => {
    if (id === focusId) return;
    // The drawer showed the card now in the middle; it closes as the map moves, as its own
    // "Walk the map from here" does.
    drawer.close();
    onFocus(id);
  };
  // One way back, a step at a time: a trail of names above the picture beside this button and
  // "Back to the card list" made three routes on one phone screen (orbit round 2).
  const back = (i: number) => {
    onFocus(trail[i]!);
  };
  const tap = (id: string) => {
    if (id === focusId) { setSel(null); setPair(null); setSector(null); return; }
    // A card on the map that doesn't work with this one (one you walked through, or a partner of
    // an earlier middle) has nothing to read here: a tap walks to it.
    if (sel === id || !o.sectors.some((s) => s.partners.some((p) => p.card.id === id))) centre(id);
    else {
      setSel(id); setPair(null); setSector(null);
      // THE CARD OPENS IN THE DRAWER (owner, 2026-09-27: the panel's box "is not very informative").
      // The drawer has its text, its links and "Walk the map from here"; a second tap still walks.
      const c = m.cards.get(id);
      if (c && !c.isToken) drawer.open(drawer.known.has(c.name) ? c.name : c.physical);
    }
  };
  // A TAP ON EMPTY SPACE CLEARS THE PICK (owner, 2026-09-27: "you just stay on what you have chosen").
  const blank = () => { setSel(null); setPair(null); setSector(null); };
  /** WHAT A PLAYER CAN DO WITH A CARD ON THE MAP, in one place (owner, 2026-09-27): read how it
   *  works with the middle card, walk to it, read its text, pin it across the report, open its
   *  own page, copy its name. On the map itself: back to where the walk began, and the motion. */
  const menuFor = (id: string | null): MenuItem[] => {
    if (id === null) {
      const start = trail[0] ? m.cards.get(trail[0]) : undefined;
      return [
        ...(start ? [{ label: `Back to ${firstPart(start)}, where you started`, run: () => back(0) }] : []),
        ...(still ? [] : [{ label: paused ? "Play the motion" : "Pause the motion", run: () => setPaused(!paused) }]),
      ];
    }
    const c = m.cards.get(id);
    if (!c) return [];
    const first = firstPart(c);
    const partner = o.sectors.some((s) => s.partners.some((p) => p.card.id === id));
    const readable = !c.isToken && (drawer.known.has(c.name) || drawer.known.has(c.physical));
    const items: MenuItem[] = [];
    if (id !== focusId && partner) items.push({ label: `How it works with ${firstPart(o.focus)}`, run: () => { setSel(id); setPair(id); setSector(null); } });
    if (id !== focusId) items.push({ label: `Put ${first} in the middle`, run: () => centre(id) });
    if (readable) items.push({ label: "Read the card", run: () => drawer.open(drawer.known.has(c.name) ? c.name : c.physical) });
    if (!c.isToken) items.push({ label: "Open its card page", href: `/cards/${slugOf(c.physical)}` });
    items.push({ label: "Copy the name", run: () => { void navigator.clipboard?.writeText(c.isToken ? c.name : c.physical).catch(() => {}); } });
    return items;
  };
  const focusName = displayName(o.focus);
  const selected = pair ? o.sectors.flatMap((s) => s.partners).find((p) => p.card.id === pair) : undefined;
  const openSector = sector !== null ? o.sectors.find((s) => sectorKey(s) === sector) : undefined;
  const prev = trail.length ? m.cards.get(trail[trail.length - 1]!) : undefined;

  const map = (
    <Constellation model={m} orbit={o} trail={trail} lit={sel ?? hover} still={still || paused} narrow={narrow} onTap={tap} onHover={setHover} onBlank={blank}
      pick={lead !== undefined ? allPartners : undefined} menuFor={menuFor} isAdded={(id) => { const c = m.cards.get(id); return !!c && !c.isToken && drawer.isAdded(c.physical); }} />
  );
  const panelBody = (
    <>
      {/* THE WAY BACK, WHERE THE EYE ALREADY IS: after centring a card, the only way back was a
        * word in the trail above the picture, which one seat never found and another called
        * "one word high" (orbit round 1). */}
      {/* WHERE THE WALK HAS BEEN, AS A PATH (Walk mockup, 2026-09-27): "Inalla › Bloodline
        * Necromancer › Impact Tremors", each step a way back to it. */}
      {trail.length && !selected && !openSector ? (
        <nav aria-label="Your path" className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
          {trail.map((id, i) => {
            const c = m.cards.get(id);
            return c ? (
              <Fragment key={id}>
                <button type="button" className="min-h-9 text-[#D4A63A] hover:underline" onClick={() => back(i)}>{firstPart(c)}</button>
                <span aria-hidden="true" className="text-(--muted)">›</span>
              </Fragment>
            ) : null;
          })}
          <b aria-current="page">{firstPart(o.focus)}</b>
        </nav>
      ) : null}
      {prev && !selected && !openSector ? (
        <button type="button" className="min-h-11 self-start rounded-(--radius) border border-(--separator) px-3 hover:border-(--foreground)" onClick={() => back(trail.length - 1)}>
          ← Back to {displayName(prev)}
        </button>
      ) : null}
      {selected
        ? <PartnerPanel focus={o.focus} p={selected} onCentre={() => centre(selected.card.id)} onClose={() => { setSel(null); setPair(null); }} />
        : openSector
          ? <SectorPanel s={openSector} focus={o.focus} onPick={(id) => { setSel(id); setPair(id); }} onClose={() => setSector(null)} />
          : <Summary o={o} paused={paused} onPause={still ? undefined : () => setPaused(!paused)} onSector={(s) => setSector(sectorKey(s))} onCentre={centre} />}
    </>
  );
  const panelKey = `${o.focus.id}|${pair ?? ""}|${sector ?? ""}`;

  if (lead !== undefined) {
    // THE MOCKUP'S FIRST SCREEN: theme and key on the left, the map on the right, both inside one
    // screen at 1280 by 860. A grid, so a phone reads theme, map, key in that order.
    return (
      <div className="grid gap-4 py-2 lg:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)] lg:gap-x-8 lg:items-start">
        <div className="lg:col-start-1 lg:row-start-1">{lead}</div>
        <div className="min-w-0 lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:max-w-[calc((100svh-15rem)*1.2222)]">{map}</div>
        <div ref={panel} key={panelKey} className="orbit-panel-in flex min-w-0 flex-col gap-3 text-sm scroll-mt-4 lg:col-start-1 lg:row-start-2" aria-live="polite">
          {panelBody}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 py-2">
      <nav aria-label="Cards you have centred" className="flex flex-wrap items-center gap-1 text-sm text-(--muted)">
        <b className="text-(--foreground)" aria-current="page">{focusName}</b>
      </nav>
      {/* ON A WIDE SCREEN THE PICTURE TAKES THE ROOM: at 1920 the ring stopped at 880px and the
        * panel at 440px, leaving a third of the screen empty (owner, 2026-09-26). The ring fills
        * what the panel leaves of its container, up to the screen's height, so the same view fits
        * a report chapter and a full-screen overlay; the panel stays in view beside it. */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-center lg:gap-8">
        {/* The map's width is capped by the screen's height (the box is 880 by 720), so all of it
          * stays on screen; the map and panel sit together, centred. */}
        <div className="min-w-0 lg:flex-1 lg:max-w-[calc((100svh-17rem)*1.2222)]">{map}</div>
        <div ref={panel} key={panelKey} className={`orbit-panel-in flex min-w-0 flex-col gap-3 rounded-(--radius) border border-(--separator) bg-(--surface) p-3 text-sm lg:w-[min(34rem,40%)] lg:shrink-0 lg:overflow-y-auto ${sticky
          ? "scroll-mt-[calc(var(--site-header-h,0px)+var(--report-header-h,0px)+1rem)] lg:sticky lg:top-[calc(var(--site-header-h,0px)+var(--report-header-h,0px)+1rem)] lg:max-h-[calc(100svh-var(--site-header-h,0px)-var(--report-header-h,0px)-2rem)]"
          : "scroll-mt-4 lg:max-h-[calc(100svh-7rem)]"}`} aria-live="polite">
          {panelBody}
        </div>
      </div>
    </div>
  );
}

const sectorKey = (s: OrbitSector) => s.key;

/** "Inalla" for "Inalla, Archmage Ritualist"; a back face keeps whose back it is. */
/** The reader's pause switch for the moving lines, remembered on this device when storage allows.
 *  Moving content that runs on its own needs a way to stop it (WCAG 2.2.2). */
export function usePaused(): [boolean, (v: boolean) => void] {
  const [paused, setPausedState] = useState(() => {
    try { return typeof localStorage !== "undefined" && localStorage.getItem("orbit-paused") === "1"; } catch { return false; }
  });
  const set = (v: boolean) => {
    setPausedState(v);
    try { localStorage.setItem("orbit-paused", v ? "1" : "0"); } catch { /* storage blocked: the switch still works for this visit */ }
  };
  return [paused, set];
}

/** Whether the reader asked for less motion, following changes. */
export function useReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [still, setStill] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setStill(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return still;
}

function firstPart(c: EngineCard): string {
  const front = c.name.split(",")[0]!;
  return c.faceOf ? `${front} (back of ${c.faceOf.split(",")[0]})` : front;
}

/** One "Through X" group. Each name opens its own line and both cards' text: one example sentence
 *  over 25 names could not be checked (orbit round 2). */
function Through({ t, onCentre }: { t: OrbitModel["through"][number]; onCentre: (id: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const card = open ? t.cards.find((c) => c.id === open) : undefined;
  const lines = card ? (t.lines.get(card.id) ?? []) : [];
  return (
    <li className="flex flex-col gap-1">
      <span className="flex items-center gap-2">
        <Art card={t.via} size={28} />
        <span className="flex-1">Through <b>{displayName(t.via)}</b> <span className="text-(--muted)">({t.cards.length})</span></span>
        <button type="button" className="min-h-9 shrink-0 rounded-(--radius) border border-(--separator) px-2 text-xs" onClick={() => onCentre(t.via.id)}>Put it in the middle</button>
      </span>
      {t.example && !card ? <span className="text-xs text-(--muted)"><Badge repeat={t.example.repeat} perTurn={t.example.perTurn} /><ReasonText text={t.example.text} /></span> : null}
      {/* The answer opens right under the name tapped: below the whole list it landed ~460px from
        * the thumb on a phone (orbit round 3). A full-width box breaks the wrapped line there. */}
      <span className="flex flex-wrap gap-x-2 gap-y-0.5">
        {t.cards.map((c, i) => (
          <Fragment key={c.id}>
            <button type="button" aria-expanded={open === c.id} className={`min-h-9 text-left hover:underline ${open === c.id ? "font-semibold text-(--accent)" : ""}`} onClick={() => setOpen(open === c.id ? null : c.id)}>
              {displayName(c)}{i < t.cards.length - 1 ? "," : ""}
            </button>
            {card && open === c.id ? (
              <div className="my-1 flex w-full flex-col gap-1.5 rounded-(--radius) border border-(--separator) bg-(--background) p-2">
                <Lines links={lines} />
                <ReadCards cards={[t.via, card]} />
                <button type="button" className="min-h-9 self-start rounded-(--radius) border border-(--separator) px-2 text-xs" onClick={() => onCentre(card.id)}>Put {firstPart(card)} in the middle</button>
              </div>
            ) : null}
          </Fragment>
        ))}
      </span>
    </li>
  );
}

function Summary({ o, paused, onPause, onSector, onCentre }: { o: OrbitModel; paused: boolean; onPause?: () => void; onSector: (s: OrbitSector) => void; onCentre: (id: string) => void }) {
  const name = displayName(o.focus);
  const first = firstPart(o.focus);
  return (
    <>
      {/* THE COMMANDER'S FACE AND NAME ARE THE HERO'S, just above the map (owner, 2026-09-27: "less
        *  is more"); a card walked to shows its own. The tap hint is the map's heading. */}
      <div className="flex items-start gap-3">
        {o.focus.isCommander ? null : <CardFace card={o.focus} className="w-24" />}
        <div className="flex flex-col gap-1">
          {o.focus.isCommander ? null : <h3 className="font-semibold text-base">{name}</h3>}
          <p className="text-(--muted)">
            {o.direct + o.directTokens === 0
              ? "Nothing else in the deck works with this card."
              : <>Works with <b className="text-(--foreground)">{o.direct} card{o.direct === 1 ? "" : "s"}</b>{o.directTokens ? <> and {o.directTokens} token{o.directTokens === 1 ? "" : "s"}</> : null}.</>}
          </p>
        </div>
      </div>
      {o.sectors.length ? (
        // WHAT THESE COUNTS COUNT (appeal review 2026-09-26): "Wizards entering 18 cards" here beside
        // "Wizards entering 37 cards" in the themes read as a contradiction. These are the cards that
        // work with THIS card, split by what links them.
        <>
        <p className="text-xs text-(--muted)">Those cards, by what links them to {first}:</p>
        <ul className="flex flex-col gap-1">
          {o.sectors.map((s) => (
            <li key={s.name}>
              <button type="button" className="flex min-h-11 w-full items-center gap-2 rounded-(--radius) px-1 text-left hover:bg-(--surface-secondary)" onClick={() => onSector(s)}>
                <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ background: s.hue }} />
                <span className="flex-1">{s.name}</span>
                <span className="text-(--muted) whitespace-nowrap">{countText(s.partners.length, s.partners.filter((p) => p.once).length)}</span>
              </button>
            </li>
          ))}
        </ul>
        </>
      ) : null}
      <p className="text-xs text-(--muted)">
        {onPause ? (
          <button type="button" className="float-right ml-2 rounded-(--radius) border border-(--separator) px-2 py-1 text-xs hover:border-(--foreground)" aria-pressed={paused} onClick={onPause}>
            {paused ? "Play the motion" : "Pause the motion"}
          </button>
        ) : null}
        {/* ONE LINE (owner, 2026-09-27: "less is more"): it was a paragraph on dashes, the gold line
          *  and right-click, which the map shows by doing them. */}
        Tap a card to read it, tap it again to put it in the middle. A solid line keeps working; a dashed line works once.</p>
      <ReadCards cards={[o.focus]} />
      {o.through.length ? (
        <details>
          <summary className="cursor-pointer py-1.5">
            <b>{o.near.length} more card{o.near.length === 1 ? "" : "s"}</b> work with a card around {first}, but not with {first} itself
          </summary>
          <ul className="mt-2 flex flex-col gap-3">
            {o.through.map((t) => <Through key={t.via.id} t={t} onCentre={onCentre} />)}
          </ul>
        </details>
      ) : null}
      {o.far.length ? (
        <details>
          <summary className="cursor-pointer py-1.5">
            <b>{o.far.length} card{o.far.length === 1 ? "" : "s"}</b> don't connect to {first}, even through another card
          </summary>
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            {o.far.map((card) => (
              <li key={card.id}><button type="button" className="min-h-9 text-left hover:underline" onClick={() => onCentre(card.id)}>{displayName(card)}</button></li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}

function SectorPanel({ s, focus, onPick, onClose }: { s: OrbitSector; focus: EngineCard; onPick: (id: string) => void; onClose: () => void }) {
  const partnerOf = (l: OrbitPartner["links"][number]) => (l.from === focus.id ? l.to : l.from);
  return (
    <>
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ background: s.hue }} />
        <h3 className="flex-1 font-semibold text-base">{s.name}</h3>
        <button type="button" className="min-h-11 rounded-(--radius) border border-(--separator) px-3" onClick={onClose}>Back</button>
      </div>
      <p className="text-(--muted)">The {countText(s.partners.length, s.partners.filter((p) => p.once).length)} here that work with {displayName(focus)}. Tap one for every line and both cards' text.</p>
      <ul className="flex flex-col gap-1">
        {sameLine(s.partners, partnerOf).map((row) => row.cards.length > 2 ? (
          // ONE SENTENCE, MANY NAMES: fifteen rows of "When X enters because Inalla copies it…"
          // with only the name changing read as a wall (orbit round 2).
          <li key={row.key} className="flex flex-col gap-1 rounded-(--radius) border border-(--separator) p-2">
            <span className="text-xs text-(--muted)"><Badge repeat={row.repeat} perTurn={row.perTurn} />{row.sentence}</span>
            <span className="flex flex-wrap gap-x-2 gap-y-1">
              {row.cards.map((p) => (
                <button key={p.card.id} type="button" className="flex min-h-9 items-center gap-1.5 rounded-(--radius) px-1 text-left hover:bg-(--surface-secondary)" onClick={() => onPick(p.card.id)}>
                  <Art card={p.card} size={24} />{displayName(p.card)}{p.card.isToken ? <span className="text-(--muted)"> {tokenLabel(p.card)}</span> : null}
                </button>
              ))}
            </span>
          </li>
        ) : row.cards.map((p) => {
          const l = p.links.find((x) => partnerOf(x) === p.card.id) ?? p.links[0];
          return (
            <li key={p.card.id}>
              <button type="button" className="flex min-h-11 w-full items-start gap-2 rounded-(--radius) px-1 py-1 text-left hover:bg-(--surface-secondary)" onClick={() => onPick(p.card.id)}>
                <Art card={p.card} size={32} />
                <span className="flex flex-1 flex-col">
                  <span>{displayName(p.card)}{p.card.isToken ? <span className="text-(--muted)"> {tokenLabel(p.card)}</span> : null}</span>
                  {l ? <span className="text-xs text-(--muted)"><Badge repeat={l.repeat} perTurn={l.perTurn} /><ReasonText text={l.text} /></span> : null}
                </span>
              </button>
            </li>
          );
        }))}
      </ul>
    </>
  );
}

/** Partners whose first line is the same sentence with only their own name changed, grouped. The
 *  sentence keeps its shape with the name swapped for "one of these". */
export function sameLine(partners: OrbitPartner[], partnerOf: (l: OrbitPartner["links"][number]) => string) {
  const rows = new Map<string, { key: string; sentence: string; repeat: OrbitPartner["links"][number]["repeat"]; perTurn?: boolean; cards: OrbitPartner[] }>();
  for (const p of partners) {
    const l = p.links.find((x) => partnerOf(x) === p.card.id) ?? p.links[0];
    const shape = l ? `${l.repeat}|${l.text.split(p.card.name).join("\u0000")}` : `solo|${p.card.id}`;
    if (!rows.has(shape)) rows.set(shape, { key: shape, sentence: l ? l.text.split(p.card.name).join("one of these") : "", repeat: l?.repeat ?? "triggered", perTurn: l?.perTurn, cards: [] });
    rows.get(shape)!.cards.push(p);
  }
  return [...rows.values()];
}

function PartnerPanel({ focus, p, onCentre, onClose }: { focus: EngineCard; p: OrbitPartner; onCentre: () => void; onClose: () => void }) {
  return (
    <>
      <div className="flex items-start gap-2">
        <CardFace card={focus} className="w-20" />
        <CardFace card={p.card} className="w-20" />
        <button type="button" aria-label="Close" className="ml-auto flex min-h-11 min-w-11 items-center justify-center rounded-(--radius) border border-(--separator) text-lg" onClick={onClose}>✕</button>
      </div>
      <h3 className="font-semibold text-base">{displayName(focus)} and {displayName(p.card)}{p.card.isToken ? <span className="text-(--muted) font-normal"> {tokenLabel(p.card)}</span> : null}</h3>
      <Lines links={p.links.slice(0, 6)} />
      {p.links.length > 6 ? <p className="text-(--muted)">…and {p.links.length - 6} more lines between them.</p> : null}
      <ReadCards cards={[focus, p.card]} />
      <details className="text-xs text-(--muted)"><summary className="cursor-pointer">What the labels mean</summary><div className="mt-1"><RepeatKey /></div></details>
      <button type="button" className="min-h-11 self-start rounded-(--radius) border border-(--accent) px-4 text-(--accent)" onClick={onCentre}>Put {firstPart(p.card)} in the middle</button>
    </>
  );
}
