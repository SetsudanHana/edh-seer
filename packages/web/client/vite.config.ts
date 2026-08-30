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
      // NOT decoded: `cardFileName` (`build-static-core.ts`) writes each file's name as
      // `encodeURIComponent(normalizedName)` and the client fetches that SAME encoded string as
      // the URL segment (`StaticLookup.prefetch`) -- so the raw request-target already matches
      // the on-disk filename character for character (`sol%20ring.json`, literal `%`,`2`,`0`).
      // Decoding here turns `%20` back into a real space, which is not a file that exists.
      const file = join(root, req.url.slice("/static/".length).split("?")[0]);
      // A 404 IS THE ANSWER, not an error: `StaticLookup` turns it into `findByName` -> null, which
      // `resolveNames` turns into `missing`. Serving a 500 here would break that contract.
      if (!file.startsWith(root) || !existsSync(file)) { res.statusCode = 404; return res.end("{}"); }
      res.setHeader("Content-Type", "application/json");
      createReadStream(file).pipe(res);
    });
  },
};

export default defineConfig({
  root: "client",
  plugins: [react(), tailwindcss(), staticOut],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3001" },
  },
});
