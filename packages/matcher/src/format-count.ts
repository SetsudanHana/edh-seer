/** A COUNT AS A PLAYER READS IT, AND NEVER ROUNDED UP (owner ruling 2026-10-27 B): a role count is FLOORED to one decimal, so 9.96 prints 9.9 and a deck a hair under its target never reads as on it, and a whole
 *  number prints without ".0". Every gap is taken from the SHOWN count, in tenths of a card, so "9.9 of 10" and "0.1 short" can never disagree. No dependencies, so the CLI, the sentence builders and the
 *  suggestions share the one helper (the web client keeps a copy, `lib/format-count.ts`, with the same tests). */
export const tenths = (n: number): number => Math.floor(n * 10 + 1e-9);
export const formatCount = (n: number): string => String(tenths(n) / 10);
/** How far a count sits under its target, from the shown count: 0.1 at least whenever the count is under it. */
export const gapShort = (count: number, target: number): number => Math.max(0, (Math.round(target * 10) - tenths(count)) / 10);
/** How far a count sits over its target, from the shown count; 0 when it only exceeds it by less than a tenth. */
export const gapOver = (count: number, target: number): number => Math.max(0, (tenths(count) - Math.round(target * 10)) / 10);
