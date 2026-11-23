import type { CatalogueField } from "../lib/search/catalogue.js";
import type { FieldFilter } from "../lib/facets.js";
import { RangeRow } from "./RangeRow.js";
import { WordPicker } from "./WordPicker.js";

/** A short list is browsed (the field offers every value on focus); a long one is typed into. */
const BROWSE_UP_TO = 12;

/** Highest bound a number field's range offers. CEILING: a select of a few hundred numbers is a scroll inside a scroll on
 *  a phone, so a field whose catalogue maximum is higher offers up to this and a bound above it is not reachable from
 *  the row (a link can still carry it, and the row shows it). Upgrade path: a number input for the high end. */
const RANGE_CEILING = 99;

/** A FILTER ROW FOR ONE CATALOGUE FIELD, drawn from the catalogue entry alone (#1782): a SET field is a WordPicker over
 *  its values (counts and the player words of `valueLabels` from the catalogue), a NUMBER field a min/max range like the
 *  mana value row. Nothing here names a field, so a field the build adds appears with no code. A field with no registry
 *  label is drawn under its path id. `field` undefined is a field this build does not know: the row keeps its place so
 *  it can be removed, and the page says why it is not answering. */
export function FieldRow(
  { id, field, filters, onChange }: {
    id: string;
    field: CatalogueField | undefined;
    filters: readonly FieldFilter[];
    /** The whole new list for THIS field. */
    onChange: (next: FieldFilter[]) => void;
  },
): React.JSX.Element {
  const label = field?.label ?? id;
  if (field?.kind === "number") {
    const range = filters.find((f): f is Extract<FieldFilter, { op: "range" }> => f.op === "range");
    return (
      <RangeRow
        label={label}
        {...(field.description ? { description: field.description } : {})}
        min={range?.min} max={range?.max}
        ceiling={Math.max(Math.min(field.max ?? 15, RANGE_CEILING), range?.min ?? 0, range?.max ?? 0)}
        onChange={(r) => onChange(r.min === undefined && r.max === undefined ? [] : [{ field: id, op: "range", ...(r.min !== undefined ? { min: r.min } : {}), ...(r.max !== undefined ? { max: r.max } : {}) }])}
      />
    );
  }
  if (field === undefined) return <span className="eyebrow">{label}</span>;
  // A VALUE THE REGISTRY LABELS IS OFFERED EVEN WITH NO CARD: the build drops empty values, and "no record" is a real answer.
  const held = field.values ?? [];
  const values = [...held, ...Object.keys(field.valueLabels ?? {}).filter((v) => !held.some((h) => h.v === v)).map((v) => ({ v, n: 0 }))];
  const counts = new Map(values.map((v) => [v.v, v.n] as const));
  const of = (op: "must" | "any" | "not"): string[] => filters.flatMap((f) => (f.op === op ? [f.value] : []));
  const emit = (must: string[], any: string[], not: string[]): void => onChange([
    ...must.map((value): FieldFilter => ({ field: id, op: "must", value })),
    ...any.map((value): FieldFilter => ({ field: id, op: "any", value })),
    ...not.map((value): FieldFilter => ({ field: id, op: "not", value })),
  ]);
  const must = of("must"); const any = of("any"); const not = of("not");
  const without = (xs: string[], name: string) => xs.filter((w) => w !== name);
  return (
    <WordPicker
      label={label}
      {...(field.description ? { description: field.description } : {})}
      listLabel={`${label} values`}
      placeholder={values.length <= BROWSE_UP_TO ? "Pick a value…" : "Type to find a value…"}
      all={values.map((v) => v.v)}
      chosen={must}
      anyOf={any}
      negated={not}
      plain
      browse={values.length <= BROWSE_UP_TO}
      labelOf={(v) => field.valueLabels?.[v] ?? v}
      optionText={(v) => `${field.valueLabels?.[v] ?? v} (${(counts.get(v) ?? 0).toLocaleString("en-US")})`}
      onChange={(next) => emit(next, any, not)}
      onMove={(name, to) => {
        const m = without(must, name); const a = without(any, name); const n = without(not, name);
        if (to === "and") emit([...m, name], a, n);
        else if (to === "any") emit(m, [...a, name], n);
        else emit(m, a, [...n, name]);
      }}
      onRemoveAny={(name) => emit(must, without(any, name), not)}
      onRemoveNegated={(name) => emit(must, any, without(not, name))}
    />
  );
}
