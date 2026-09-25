import { createReadStream, existsSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/** THE PAIR-JUDGING TOOL, MOUNTED ON THE DEV SERVER (2026-09-25). `#calibrate` posts to
 *  `/api/calibrate/*`; that was a NestJS controller until the server was removed, and is now
 *  `@edh-seer/matcher/calibration-judge`, loaded through Vite's own SSR loader so its TypeScript and
 *  workspace imports resolve exactly as they do everywhere else. DEV-ONLY (`apply: "serve"`), and
 *  off unless `MTG_CALIBRATE=1`: a verdict writes the files the calibration ratchet reads, so the
 *  gate is `calibrateEnabled`, the tested one, not a second copy of it here. Off, every route
 *  answers 404, which the panel already explains as "not enabled". The Mongo connection and the
 *  sampling universe are built on the first request, not at startup, so a dev server that never
 *  opens the panel never touches the database. */
const calibrateApi = {
  name: "edh-seer-calibrate-api",
  apply: "serve" as const,
  configureServer(server: {
    ssrLoadModule(id: string): Promise<Record<string, unknown>>;
    middlewares: { use(fn: (req: any, res: any, next: () => void) => void): void };
  }) {
    type Judge = typeof import("@edh-seer/matcher/calibration-judge");
    let judge: Promise<{ mod: Judge; deps: Awaited<ReturnType<Judge["openCalibrationJudge"]>> | null }> | undefined;
    const repoRoot = process.cwd().replace(/\/packages\/.*$/, "");
    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith("/api/calibrate/")) return next();
      const send = (status: number, json: unknown) => {
        res.statusCode = status;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(json));
      };
      try {
        judge ??= (server.ssrLoadModule("@edh-seer/matcher/calibration-judge") as Promise<Judge>).then(async (mod) => ({
          mod, deps: mod.calibrateEnabled(process.env) ? await mod.openCalibrationJudge(repoRoot) : null,
        }));
        const { mod, deps } = await judge;
        if (!deps) return send(404, { message: "the calibration tool is off; start the dev server with MTG_CALIBRATE=1" });
        let raw = "";
        for await (const chunk of req) raw += chunk;
        let body: unknown;
        try { body = raw ? JSON.parse(raw) : undefined; } catch { return send(400, { message: "body is not JSON" }); }
        const out = await mod.handleCalibrateRequest(deps, req.method ?? "GET", req.url.split("?")[0], body);
        send(out.status, out.json);
      } catch (e) {
        judge = undefined; // a failed connect is retried on the next request, not cached
        send(500, { message: e instanceof Error ? e.message : "calibration tool failed" });
      }
    });
  },
};

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
 *  NO REGEX. `replace(/<!--[\s\S]*?-->/g, "")` is the obvious version and it fails CodeQL's
 *  `js/incomplete-multi-character-sanitization` as a high-severity alert, because one pass over an
 *  UNTERMINATED `<!--` leaves the marker in the output. The rule is right about the string even
 *  though this is a build-time pass over our own file rather than sanitisation. Scanning indices
 *  cannot leave one behind, and it reads more plainly than the regex did.
 *
 *  AN UNTERMINATED COMMENT TAKES THE REST WITH IT, which is what a browser does too: `<!--` with no
 *  `-->` comments out everything after it, so dropping the tail matches how the document would have
 *  rendered anyway. */
const stripHtmlComments = {
  name: "edh-seer-strip-html-comments",
  apply: "build" as const,
  transformIndexHtml: {
    order: "post" as const,
    handler: (html: string): string => {
      let out = "";
      let i = 0;
      for (;;) {
        const start = html.indexOf("<!--", i);
        if (start === -1) { out += html.slice(i); break; }
        out += html.slice(i, start);
        const end = html.indexOf("-->", start + 4);
        if (end === -1) break;
        i = end + 3;
      }
      // Bounded repetition of one character: no ambiguity for the ReDoS rule to find.
      return out.replace(/\n{3,}/g, "\n\n");
    },
  },
};

export default defineConfig({
  root: "client",
  plugins: [react(), tailwindcss(), staticOut, calibrateApi, stripHtmlComments],
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
    // The importer is a Cloudflare Worker with a Durable Object pacer, so dev points at
    // `wrangler dev` and exercises the real thing, pacing included. Without it running, an import
    // fails with the "could not reach" message, which is the honest outcome rather than a stub that
    // behaves better than production. `/api/calibrate` is the plugin above; there is no other API.
    proxy: {
      "/api/import": "http://127.0.0.1:8788",
    },
  },
});
