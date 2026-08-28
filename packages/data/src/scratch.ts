import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A scratch directory for the measurement bins, owned by the current user and readable only by
 *  them.
 *
 *  CodeQL js/insecure-temporary-file, 24 alerts: the bins defaulted to fixed paths like
 *  `/tmp/precision`. `/tmp` is world-writable and sticky, so on a shared machine another user can
 *  pre-create that path — or a symlink pointing anywhere the bin's user can write — and the bin
 *  then writes through it.
 *
 *  `mkdtemp` is the usual answer and is WRONG HERE, because these paths are a handoff: the sampling
 *  bins write a draw that the scoring bins read back (precision-sample -> precision-score,
 *  normalize-experiment -> normalize-score, dump-suspects -> reconcile, schema-experiment ->
 *  experiment-compare). A random directory per run would break every one of those pairs.
 *
 *  So the path stays STABLE and the exposure is removed instead: one parent directory per user id,
 *  created 0o700, with the well-known name underneath it. `mkdirSync` with an explicit mode is not
 *  a race-free create, but it does mean the attacker's path is no longer guessable and the parent
 *  is not writable by anyone else. */
export function scratchDir(name: string): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : "shared";
  const parent = join(tmpdir(), `edh-seer-${uid}`);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const dir = join(parent, name);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
