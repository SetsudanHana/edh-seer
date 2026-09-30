import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { slugOf as slugOfName } from "@edh-seer/matcher/slug";
import { analyzeDeckStatic } from "../api.static.js";
import { buildEngineModel } from "../lib/engine-model.js";
import { buildOrbit } from "../lib/orbit-model.js";
import { identityLabel } from "../lib/color-identity.js";
import { year } from "../lib/precon-html.js";
import { loadPrecon, preconDecklist, type PreconRecord } from "../lib/precons.js";
import type { PreconPage as Page } from "../lib/precon-page.js";
import type { AnalyzeResponse } from "../types.js";
import { cardImageUrl } from "./card-node.js";
import { CardDrawerProvider, useCardDrawer } from "./card-drawer.js";
import { allPartners, Constellation } from "./Constellation.js";
import { useNarrow } from "./engine-parts.js";
import { useIsNarrow } from "../lib/use-narrow.js";
import { ManaSymbols } from "./ManaSymbols.js";

/** `/precons/:slug` (Precon mockup, 2026-09-27): the precon's theme and scores beside its
 *  commander's map, then the swaps that make its cards work together more, then the list. The page
 *  is the file `build-precons` wrote; only the map is drawn live, from the list, once the page is up. */
export function PreconPage() {
  const { slug = "" } = useParams();
  const [rec, setRec] = useState<PreconRecord | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setRec(undefined);
    void loadPrecon(slug).then((r) => { if (live) setRec(r); });
    return () => { live = false; };
  }, [slug]);
  if (rec === undefined) return <p className="py-10 text-(--muted)" role="status">Loading the precon</p>;
  if (rec === null) {
    return (
      <div className="flex flex-col gap-3 py-10">
        <h1 className="text-2xl font-bold">No precon page here</h1>
        <p className="text-(--muted)">No Commander precon goes by that name. <Link className="text-(--accent) underline" to="/precons">Every precon we read</Link>.</p>
      </div>
    );
  }
  return <PreconView page={rec.page} siblings={rec.siblings} />;
}

const MAX_BAR = (p: Page) => Math.max(1, ...p.swaps.flatMap((s) => [s.out.connections, s.in.connections]));

function PreconView({ page: p, siblings }: { page: Page; siblings: PreconRecord["siblings"] }) {
  const max = MAX_BAR(p);
  const pip = p.identity.map((c) => `{${c}}`).join("");
  return (
    <div className="flex flex-col gap-12 py-6" data-testid="precon-page">
      {/* THE MAP TAKES THE ROW (designer review 2026-09-30, #770): capped at 30rem it was a 480x393
        *  picture in the top-right corner of a 2560 screen with ~1,500px of nothing between it and
        *  the header. The header keeps its measure; the map has the rest, 16:9 from 1600px, held to
        *  the screen's height so the swaps still start on the first screen. */}
      <section className="grid items-center gap-8 lg:grid-cols-[minmax(0,34rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <nav aria-label="Breadcrumb" className="text-sm text-(--muted)"><Link to="/precons" className="hover:text-(--foreground)">Precons</Link> › {p.setName}</nav>
          <span className="eyebrow text-(--muted)">Commander precon · {p.setName}{p.releaseDate ? ` · ${year(p.releaseDate)}` : ""}</span>
          <h1 className="text-4xl font-bold leading-tight tracking-[-0.02em]">{p.name}</h1>
          <p className="text-(--muted)">
            {p.commanders.map((c, i) => <span key={c}>{i > 0 ? " and " : ""}<Link className="hover:text-(--foreground)" to={`/commanders/${slugOfName(c)}`}>{c}</Link></span>)}
            {pip ? <> · <span aria-hidden="true" className="inline-flex align-[-0.15em]"><ManaSymbols cost={pip} /></span> {identityLabel(p.identity)}</> : null}
          </p>
          <div className="flex flex-wrap gap-2" data-testid="precon-facts">
            {p.theme ? <Fact label="Main theme" value={p.theme} /> : null}
            {p.synergy ? <Fact label="Synergy" value={<>{p.synergy.score.toFixed(1)}<span className="text-sm text-(--muted)">/5</span></>} note={p.synergy.band.toLowerCase()} /> : null}
            {p.bracket ? <Fact label="Bracket" value={p.bracket.band.replace("-", "–")} note={p.bracket.gameChangers ? `${p.bracket.gameChangers} Game Changer${p.bracket.gameChangers === 1 ? "" : "s"}` : "no Game Changers"} /> : null}
          </div>
          <p className="max-w-[60ch] text-lg">
            {/* SAID AS WHAT IT IS: an engine that reads no link is not a deck with none (Yidris, Zedruu). */}
            {p.commanderLinks > 0 ? `${p.commanders[0]} works with ${p.commanderLinks} of its cards.` : `No card in it links to ${p.commanders[0]} in a way the engine reads yet.`}
            {p.swaps.length ? ` ${spell(p.swaps.length)} swaps below give its loosest cards a job in its plan.` : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            {p.swaps.length ? <a href="#swaps" className="inline-flex min-h-11 items-center rounded-full bg-(--accent) px-5 font-medium text-(--accent-foreground)">See the {spell(p.swaps.length).toLowerCase()} swaps ↓</a> : null}
            {p.report ? <a href={p.report} className="inline-flex min-h-11 items-center rounded-full border border-(--separator) px-5 font-medium hover:border-(--foreground)">Open the full report</a> : null}
          </div>
        </div>
        <div className="min-w-0 w-full justify-self-center lg:max-w-[calc(55svh*1.2222)] min-[100rem]:max-w-[calc(55svh*1.7778)]">
          <PreconMap page={p} />
        </div>
      </section>

      {p.swaps.length ? (
        <section id="swaps" className="flex scroll-mt-24 flex-col gap-3" aria-labelledby="swaps-title">
          <span className="eyebrow text-(--muted)">Upgrade for synergy</span>
          <h2 id="swaps-title" className="text-2xl font-bold">{spell(p.swaps.length)} swaps that make the deck work together</h2>
          <p className="max-w-[70ch] text-(--muted)">Each card out works with few other cards in the deck; each card in works with many. The bars count the deck cards each one works with.</p>
          {/* SIDE BY SIDE AS THE WIDTH ALLOWS (designer review 2026-09-29): each swap row spanned the
            *  screen, and at 3840 "TAKE OUT" sat at the left edge, "PUT IN" at half way and the bars
            *  at the far right, 1,700px of row between them. A row keeps its own out -> in -> bars
            *  shape; a wide screen takes two, three or four of them across. */}
          {/* AN EVEN COUNT SPLITS EVENLY (designer review 2026-09-30): four swaps in auto-fit's three
            *  columns left the fourth alone with two thirds of its row empty. */}
          <ul className={`grid gap-2.5 ${p.swaps.length % 2 === 0 ? "min-[100rem]:grid-cols-2 min-[200rem]:grid-cols-4" : "[grid-template-columns:repeat(auto-fit,minmax(min(100%,40rem),1fr))]"}`} data-testid="precon-swaps">
            {p.swaps.map((s) => (
              <li key={s.in.name} className="grid gap-x-4 gap-y-2 rounded-(--radius) border border-(--separator) bg-(--surface) p-3 sm:grid-cols-[minmax(0,1fr)_1.5rem_minmax(0,1fr)_12rem] sm:items-center">
                <div className="flex flex-col"><span className="eyebrow text-(--muted)">Take out</span><b>{s.out.name}</b><span className="text-sm text-(--muted)">works with {s.out.connections} of its cards</span></div>
                <span aria-hidden="true" className="text-xl text-(--accent)">→</span>
                <div className="flex items-center gap-3">
                  {s.in.art ? <img src={cardImageUrl(s.in.art) ?? undefined} alt="" width={488} height={680} loading="lazy" className="w-14 shrink-0 rounded-[4.5%/3.3%] shadow-md shadow-black/40" /> : null}
                  <div className="flex min-w-0 flex-col"><span className="eyebrow text-(--accent)">Put in</span><Link to={`/cards/${s.in.slug}`} className="font-bold hover:text-(--accent)">{s.in.name}</Link><span className="text-sm text-(--muted)">works with {s.in.connections} of its cards</span></div>
                </div>
                <div className="flex flex-col gap-1.5" aria-hidden="true">
                  <Bar n={s.out.connections} max={max} tone="bg-(--fill)" />
                  <Bar n={s.in.connections} max={max} tone="bg-(--accent)" />
                </div>
                {s.in.reason ? <p className="border-t border-(--separator) pt-2 text-sm text-(--muted) sm:col-span-4">{s.in.reason}</p> : null}
              </li>
            ))}
          </ul>
          {p.route ? (
            <div className="flex items-center gap-3 rounded-(--radius) border border-dashed border-(--accent) p-3">
              {p.route.art ? <img src={cardImageUrl(p.route.art) ?? undefined} alt="" width={488} height={680} loading="lazy" className="w-14 shrink-0 rounded-[4.5%/3.3%]" /> : null}
              <div className="flex flex-col"><span className="eyebrow text-(--accent)">Opens a route</span><Link to={`/cards/${p.route.slug}`} className="font-bold hover:text-(--accent)">{p.route.name}</Link><span className="text-sm text-(--muted)">{p.route.reach} of its cards reach {p.route.to} through it.</span></div>
            </div>
          ) : null}
          {p.gaps.length ? (
            <p className="text-sm text-(--muted)">
              Also worth knowing: {p.gaps.map((g, i) => <span key={g.group}>{i === 0 ? "" : i === p.gaps.length - 1 ? " and " : ", "}<b className="text-(--foreground)">{g.target - g.have} short on {g.group.toLowerCase()}</b></span>)} for a typical Commander deck.
              {p.report ? <> The <a href={p.report} className="text-(--accent) underline underline-offset-2">full report</a> lists cards for {p.gaps.length === 1 ? "it" : p.gaps.length === 2 ? "both" : "each"}.</> : null}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="flex flex-col gap-1" aria-labelledby="list-title">
        <span className="eyebrow text-(--muted)">The decklist</span>
        <h2 id="list-title" className="mb-2 text-2xl font-bold">What&rsquo;s in the box</h2>
        {/* THE TYPES SIDE BY SIDE AND THE NAMES IN COLUMNS (designer review 2026-09-30, #770): each
          *  type was one running line of names, 3,600px long at 3840. */}
        <div className="grid items-start gap-x-8 min-[100rem]:grid-cols-2 min-[200rem]:grid-cols-4">
        {p.decklist.map((g) => (
          <div key={g.group} className="flex flex-col gap-2 border-t border-(--separator) py-3">
            <h3 className="text-sm font-semibold">{g.group} · {g.cards.reduce((t, c) => t + c.count, 0)}</h3>
            <ul className="columns-2 sm:columns-[11rem] gap-x-6 text-sm">{g.cards.map((c) => <li key={c.name} className="break-inside-avoid py-0.5">{c.count > 1 ? `${c.count} ` : ""}<Link to={`/cards/${slugOfName(c.name)}`} className="hover:text-(--accent)">{c.name}</Link></li>)}</ul>
          </div>
        ))}
        </div>
      </section>

      {siblings.length ? (
        <section className="flex flex-col gap-2">
          <span className="eyebrow text-(--muted)">Same set</span>
          <h2 className="text-xl font-bold">Other {p.setName} precons</h2>
          <div className="flex flex-wrap gap-2">
            {siblings.map((s) => <Link key={s.slug} to={`/precons/${s.slug}`} className="inline-flex min-h-11 items-center rounded-full border border-(--separator) px-4 text-sm hover:border-(--foreground)">{s.name}</Link>)}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Fact({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <div className="flex min-w-32 flex-col gap-0.5 rounded-(--radius) border border-(--separator) bg-(--surface) px-3 py-2">
      <span className="eyebrow text-(--muted)">{label}</span>
      <b className="text-xl">{value}</b>
      {note ? <span className="text-xs text-(--muted)">{note}</span> : null}
    </div>
  );
}

function Bar({ n, max, tone }: { n: number; max: number; tone: string }) {
  return (
    <span className="flex items-center gap-2 text-xs tabular-nums text-(--muted)">
      <span className={`block h-2 rounded ${tone}`} style={{ width: `${Math.max(4, (n / max) * 100)}%` }} />{n}
    </span>
  );
}

const WORDS = ["", "One", "Two", "Three", "Four", "Five", "Six"];
const spell = (n: number) => WORDS[n] ?? String(n);

/** THE COMMANDER'S MAP, DRAWN FROM THE LIST ONCE THE PAGE IS UP: the page itself is precomputed, the
 *  map needs the engine's links, so it runs the analysis the report runs and draws what the Glance
 *  map draws. Until then, and on failure, the space says so rather than jumping. */
function PreconMap({ page }: { page: Page }) {
  const [data, setData] = useState<AnalyzeResponse | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    analyzeDeckStatic(preconDecklist(page), page.commanders.join("\n"), "/static")
      .then((d) => { if (live) setData(d); }, () => { if (live) setData(null); });
    return () => { live = false; };
  }, [page]);
  if (!data?.graph) {
    return <div className="flex aspect-[880/720] min-[100rem]:aspect-[16/9] w-full items-center justify-center rounded-(--radius) text-sm text-(--muted)">{data === null ? "" : "Drawing the commander's map"}</div>;
  }
  return (
    <CardDrawerProvider graph={data.graph}>
      <MapOf data={data} commanders={page.commanders} />
    </CardDrawerProvider>
  );
}

function MapOf({ data, commanders }: { data: AnalyzeResponse; commanders: string[] }) {
  const drawer = useCardDrawer();
  const narrow = useNarrow();
  const broad = !useIsNarrow(1599);
  const [lit, setLit] = useState<string | null>(null);
  const model = useMemo(() => buildEngineModel(data.report, data.graph!), [data]);
  const wanted = new Set(commanders.flatMap((c) => [c, c.split(" // ")[0]!]));
  const id = data.graph!.nodes.find((n) => !n.face && !n.isToken && (wanted.has(n.cardName ?? n.label) || wanted.has(n.label)))?.id;
  const orbit = useMemo(() => (id ? buildOrbit(model, id) : null), [model, id]);
  if (!orbit) return null;
  return (
    <Constellation model={model} orbit={orbit} trail={[]} lit={lit} still={false} narrow={narrow} broad={broad} pick={allPartners}
      onTap={(t) => { const c = model.cards.get(t); if (c && !c.isToken) drawer.open(drawer.known.has(c.name) ? c.name : c.physical); setLit(t); }}
      onHover={setLit} onBlank={() => setLit(null)} />
  );
}
