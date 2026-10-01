import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { ShareStore } from "./store/db.js";

/** Uses server.sessionSecret, or creates a persistent random secret in the data dir. */
function sessionSecret(configured: string | undefined, dataDir: string): string {
  if (configured) return configured;
  const file = join(dataDir, "session-secret");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  const secret = randomBytes(48).toString("base64url");
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

const config = loadConfig();
config.server.staticDir ??= resolve(fileURLToPath(import.meta.url), "../../public");

const store = new ShareStore(join(config.server.dataDir, "mediatimeline.db"));
const app = await buildApp({
  config,
  store,
  sessionSecret: sessionSecret(config.server.sessionSecret, config.server.dataDir),
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await app.close();
    store.close();
    process.exit(0);
  });
}

await app.listen({ host: config.server.host, port: config.server.port });
