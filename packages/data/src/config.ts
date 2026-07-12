export interface DataConfig {
  mongoUri: string;
  dbName: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): DataConfig {
  return {
    mongoUri: env.MONGO_URI ?? "mongodb://localhost:27017",
    dbName: env.MONGO_DB ?? "mtg",
  };
}
