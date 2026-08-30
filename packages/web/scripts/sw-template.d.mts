/** The template is plain `.mjs` because `assemble-deploy.mjs` runs it with bare `node`, after the
 *  build and outside any TypeScript pipeline. This declaration is only so `pwa.test.ts` can import
 *  the same function the deploy uses rather than asserting against a copy of its output. */
export function serviceWorkerSource(input: { version: string; shell: readonly string[] }): string;
