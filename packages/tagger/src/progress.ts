/**
 * A minimal carriage-return progress bar for the CLI bins. Renders 0/total
 * immediately (so a long first LLM call doesn't look like a hang) and on each
 * tick; prints a newline when complete. `write` is injectable for testing.
 */
export function startProgress(
  total: number,
  write: (s: string) => void = (s) => process.stdout.write(s),
): { tick: () => void } {
  const width = 24;
  let done = 0;
  const render = (): void => {
    const frac = total > 0 ? done / total : 1;
    const filled = Math.round(frac * width);
    const bar = "#".repeat(filled) + "-".repeat(width - filled);
    write(`\r[${bar}] ${done}/${total}`);
    if (total > 0 && done >= total) write("\n");
  };
  render();
  return {
    tick: () => {
      done++;
      render();
    },
  };
}
