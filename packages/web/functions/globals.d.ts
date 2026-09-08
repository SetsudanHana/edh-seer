/** THE ONE CLOUDFLARE GLOBAL THESE ROUTES USE, declared rather than depended on.
 *
 *  `functions/` WAS TYPECHECKED BY NOTHING. Both tsconfigs in this package are `include: ["src"]`,
 *  so the entire edge layer -- the code that serves 17,338 card URLs, every browse page and the SPA
 *  fallback -- had zero type coverage. Found on 2026-09-08 the direct way: a Function importing
 *  `htmlHeaders` from a branch where it did not exist compiled clean, and the mistake surfaced only
 *  when a TEST in another package failed for an unrelated reason.
 *
 *  CEILING: this is the shape this repo uses, not Cloudflare's full definition -- adding
 *  `@cloudflare/workers-types` would be a dependency for a single type. Upgrade to the real package
 *  the first time a Function needs more of the runtime than `request`, `env.ASSETS`, `params` and
 *  `next` (added 2026-09-08 for `_middleware.ts`, and only it calls it). */
declare type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env & { ASSETS: { fetch: (input: Request | string) => Promise<Response> } };
  params: Record<string, string | string[]>;
  /** Middleware only: hands the request to the next Function, or to the asset store. */
  next: () => Promise<Response>;
}) => Response | Promise<Response>;
