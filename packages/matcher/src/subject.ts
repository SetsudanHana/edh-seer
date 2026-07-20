import type { SubjectFilter } from "@mtg/tagger";
import type { Hierarchy } from "./types.js";
import { impliesType } from "./hierarchy.js";

const arr = (v: string | string[] | undefined): string[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

/** Does the concrete producer subject satisfy the consumer filter? Every field the consumer
 *  leaves unset is a wildcard; a field it sets must be satisfied by the producer. */
export function subjectMatches(producer: SubjectFilter, consumer: SubjectFilter, h: Hierarchy): boolean {
  // control: equal, or `any` on either side.
  if (consumer.control !== "any" && producer.control !== "any" && consumer.control !== producer.control) {
    return false;
  }
  // token tri-state: null = any; otherwise must equal.
  if (consumer.token !== null && producer.token !== null && consumer.token !== producer.token) {
    return false;
  }
  // counter / zone: if the consumer names one, the producer must equal it.
  if (consumer.counter !== undefined && consumer.counter !== producer.counter) return false;
  if (consumer.zone !== undefined && consumer.zone !== producer.zone) return false;
  // type: an array on the consumer means OR — at least one named type must be satisfied by
  // a producer type OR a producer subtype that implies it via the hierarchy.
  const consumerTypes = arr(consumer.type);
  if (consumerTypes.length > 0) {
    const ok = consumerTypes.some(
      (ct) =>
        arr(producer.type).some((pt) => pt.toLowerCase() === ct.toLowerCase()) ||
        arr(producer.subtype).some((ps) => impliesType(h, ps, ct)),
    );
    if (!ok) return false;
  }
  // subtype: an array on the consumer means OR — at least one named subtype must be a
  // producer subtype (exact, case-insensitive).
  const consumerSubtypes = arr(consumer.subtype);
  if (consumerSubtypes.length > 0) {
    const ok = consumerSubtypes.some((cs) =>
      arr(producer.subtype).some((ps) => ps.toLowerCase() === cs.toLowerCase()),
    );
    if (!ok) return false;
  }
  return true;
}
