import { createReadStream, existsSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/** DEV-ONLY, and `apply: "serve"` is what keeps it out of the production build — the built app
 *  fetches `/static` from wherever it is hosted, which is scope B's problem, not this file's.
 *  `static-out/` holds 35,713 files, so `publicDir` is the wrong tool: it copies. */
const staticOut = {
  name: "edh-seer-static-out",
  apply: "serve" as const,
  configureServer(server: { middlewares: { use(fn: (req: any, res: any, next: () => void) => void): void } }) {
    const root = join(process.cwd().replace(/\/packages\/.*$/, ""), "static-out");
    server.middlewares.use((req, res, next) => {
      if (!req.url?.startsWith("/static/")) return next();
      // DECODED, LIKE EVERY REAL HOST. This middleware used to skip the decode to match a layout
      // that wrote `sol%20ring.json` as a literal filename -- an arrangement only this middleware
      // and the parity bin's filesystem shim agreed with, while Pages, R2, nginx and even
      // `python3 -m http.server` decode a request path once before matching it and served a 404 for
      // every card. Shard names are hex now, so decoding is a no-op on them and this line no longer
      // has an opinion that can be wrong.
      const file = join(root, decodeURIComponent(req.url.slice("/static/".length).split("?")[0]));
      // A 404 IS THE ANSWER, not an error: `StaticLookup` turns it into `findByName` -> null, which
      // `resolveNames` turns into `missing`. Serving a 500 here would break that contract.
      if (!file.startsWith(root) || !existsSync(file)) { res.statusCode = 404; return res.end("{}"); }
      res.setHeader("Content-Type", "application/json");
      createReadStream(file).pipe(res);
    });
  },
};

/** THE COMMENTS IN `index.html` ARE FOR US AND THEY WERE SHIPPING TO EVERYONE. Measured on the live
 *  `/cards/impact-tremors` (2026-09-18): 38.0 KB served, 11.4 KB of it HTML comments against 5.6 KB
 *  of visible text -- 29% of every byte a reader and every crawler downloaded was an internal essay
 *  about a nav decision. `how-it-works/index.html` carries 8.5 KB more.
 *
 *  BUILD ONLY, so the source keeps them. They are the reasoning behind hand-written markup that no
 *  component file explains, and a comment nobody can read while editing the file is worse than no
 *  comment. `apply: "build"` leaves the dev server showing what the author wrote.
 *
 *  A PLAIN LITERAL MATCH, no leading `\s*`: an ambiguous whitespace prefix before a literal is the
 *  shape CodeQL's polynomial-ReDoS rule has failed this repo's required check for twice. The blank
 *  lines it leaves are collapsed by the bounded pass after it. */
const stripHtmlComments = {
  name: "edh-seer-strip-html-comments",
  apply: "build" as const,
  transformIndexHtml: {
    order: "post" as const,
    handler: (html: string): string =>
      html.replace(/<!--[\s\S]*?-->/g, "").replace(/\n{3,}/g, "\n\n"),
  },
};

export default defineConfig({
  root: "client",
  plugins: [react(), tailwindcss(), staticOut, stripHtmlComments],
  build: {
    rollupOptions: {
      // TWO HTML ENTRIES. `how-it-works/` is prose, not an app route: listing it here makes Vite
      // rewrite its stylesheet href to the same content-hashed CSS the app ships, so the two cannot
      // drift, and emits it as `dist/how-it-works/index.html`, which is the URL the dev server
      // answers. The deploy step (`assemble-deploy.mjs`) renames that to `dist/how-it-works.html`,
      // because Pages 308s a directory index to its slash form and serves `<name>.html` at the
      // bare URL. It pulls in no JavaScript, so a reader with JS off, and every crawler that does
      // not run it, gets the whole page.
      input: {
        main: "client/index.html",
        howItWorks: "client/how-it-works/index.html",
      },
    },
  },
  server: {
    port: 5173,
    // `/api/import` FIRST, because vite matches proxy prefixes in insertion order and `/api` would
    // otherwise swallow it. Nest has no import route -- the importer is a Cloudflare Worker with a
    // Durable Object pacer -- so dev points at `wrangler dev` and exercises the real thing, pacing
    // included. Without it running, an import fails with the "could not reach" message, which is the
    // honest outcome rather than a stub that behaves better than production.
    proxy: {
      "/api/import": "http://127.0.0.1:8788",
      "/api": "http://localhost:3001",
    },
  },
});
