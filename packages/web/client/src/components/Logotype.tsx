/** THE MARK. One lowercase string, `edhseer`, split by WEIGHT first and colour second: `edh` at
 *  Inter 400 in --muted, `seer` at Inter 700 in --foreground. Weight is the primary seam because
 *  in a monochrome context (a favicon, a print, a user with forced colours) the weight difference
 *  still separates the two words where colour alone would not survive.
 *
 *  NEVER --accent. The header also carries data that is allowed to be colourful; the wordmark is
 *  the fixed point it sits against. See DESIGN.md, Logotype.
 *
 *  Written form is `EDH Seer` — the one-word lowercase form is a LOGOTYPE decision, not a naming
 *  one, so prose, page titles and package names keep the spaced form. That is why the accessible
 *  name below is "EDH Seer" and not the glyphs actually drawn.
 *
 *  CEILING: the doc calls for outlined SVG paths, not text, so the mark cannot change shape when
 *  the font stack falls back to `system-ui` — correct for UI, unacceptable for a logotype. That
 *  needs the Inter binary and a path extractor, neither of which is on this machine; until then
 *  the webfont carries it and `font-synthesis: none` at least refuses a faked bold. Upgrade path:
 *  outline `edhseer` at opsz 32, optically correct the `dh` pair, ship the paths as one SVG.
 */
export function Logotype({ size = "header" }: { size?: "display" | "header" }) {
  const display = size === "display";
  return (
    <span
      className="inline-flex items-center gap-2 select-none"
      aria-label="EDH Seer"
      role="img"
    >
      {/* 24 IS THE FLOOR, NOT A PREFERENCE: below it the outlined circle goes solid (see LogoMark)
          and the mark stops reading as two nodes and an edge — it becomes a lollipop. */}
      <LogoMark size={display ? 30 : 24} />
      <span
        aria-hidden="true"
        className={display ? "text-4xl" : "text-2xl"}
        style={{
          fontFamily: "var(--font-sans)",
          letterSpacing: display ? "-0.03em" : "-0.01em",
          fontSynthesis: "none",
          lineHeight: 1,
        }}
      >
        <span style={{ fontWeight: 400, color: "var(--muted)" }}>edh</span>
        <span style={{ fontWeight: 700, color: "var(--foreground)" }}>seer</span>
      </span>
    </span>
  );
}

/** ONE EDGE BETWEEN TWO NODES — the atomic unit of the data model, and a literal instance of what
 *  the graph draws. The two circles are deliberately UNEQUAL (small and filled, larger and
 *  outlined): equal weights read as a generic "link" glyph, and the inequality echoes the
 *  filled-vs-hollow rule the rest of the system runs on (filled = the system has data for this
 *  thing; hollow = it does not).
 *
 *  Below 24px the outlined circle goes solid: at that size a 1px ring on a ~7px circle closes up
 *  into a smudge, so size alone carries the distinction. */
export function LogoMark({ size = 22 }: { size?: number }) {
  const solid = size < 24;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {/* HORIZONTAL, not diagonal. Drawn on a diagonal the small filled dot and the ring read as a
          magnifying glass — a search affordance, which is the wrong promise for a mark that is
          supposed to say "two things, and the relation between them". */}
      <line x1="7.5" y1="12" x2="12" y2="12" stroke="var(--muted)" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="5" cy="12" r="2.5" fill="var(--muted)" />
      <circle
        cx="16.5"
        cy="12"
        r="4.5"
        fill={solid ? "var(--muted)" : "none"}
        stroke="var(--muted)"
        strokeWidth="1.5"
      />
    </svg>
  );
}
