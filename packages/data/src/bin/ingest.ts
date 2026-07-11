import { runIngest } from "../ingest.js";

runIngest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Ingest failed:", err);
    process.exit(1);
  });
