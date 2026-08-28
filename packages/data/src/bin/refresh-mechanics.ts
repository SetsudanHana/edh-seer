import { writeFileSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildSnapshot } from "../mechanics/build-snapshot.js";

const CATALOGS = {
  abilities: "https://api.scryfall.com/catalog/keyword-abilities",
  actions: "https://api.scryfall.com/catalog/keyword-actions",
  words: "https://api.scryfall.com/catalog/ability-words",
} as const;

const HEADERS = {
  "User-Agent": "edh-seer/0.0 (setsudan.hana@gmail.com)",
  Accept: "application/json",
};

async function fetchCatalog(url: string): Promise<string[]> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Scryfall ${url} -> ${res.status}`);
  const json = (await res.json()) as { data: string[] };
  return json.data;
}

async function main(): Promise<void> {
  // Fetch all three first; a partial failure must not overwrite the snapshot.
  const [abilities, actions, words] = await Promise.all([
    fetchCatalog(CATALOGS.abilities),
    fetchCatalog(CATALOGS.actions),
    fetchCatalog(CATALOGS.words),
  ]);
  const snap = buildSnapshot({ abilities, actions, words, fetchedAt: new Date().toISOString() });
  const target = fileURLToPath(new URL("../../../engine/src/mechanics.catalog.json", import.meta.url));
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, JSON.stringify(snap, null, 2) + "\n");
  renameSync(tmp, target); // atomic
  console.log(
    `wrote ${target}: abilities=${snap["keyword-ability"].length} actions=${snap["keyword-action"].length} words=${snap["ability-word"].length}`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
