import { readFileSync, existsSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const ConfigSchema = z.object({
  immich: z.object({
    url: z.url().transform((u) => u.replace(/\/+$/, "")),
    apiKey: z.string().min(1, "immich.apiKey fehlt"),
  }),
  server: z
    .object({
      host: z.string().default("0.0.0.0"),
      port: z.number().int().min(1).max(65535).default(8080),
      publicBaseUrl: z
        .url()
        .transform((u) => u.replace(/\/+$/, ""))
        .optional(),
      trustedProxies: z.array(z.string()).default(["loopback"]),
      dataDir: z.string().default("/data"),
      staticDir: z.string().optional(),
      sessionSecret: z.string().min(32).optional(),
      unlockTtlHours: z.number().positive().default(12),
    })
    .prefault({}),
  admin: z
    .object({
      userHeader: z.string().default("Remote-User"),
      groupsHeader: z.string().default("Remote-Groups"),
      allowedGroups: z.array(z.string()).default([]),
    })
    .prefault({}),
  cache: z
    .object({
      albumTtlSeconds: z.number().int().min(0).default(300),
    })
    .prefault({}),
  geocoder: z
    .object({
      // Photon (komoot) offers search-as-you-type on OpenStreetMap data, worldwide.
      url: z
        .url()
        .transform((u) => u.replace(/\/+$/, ""))
        .default("https://photon.komoot.io"),
    })
    .prefault({}),
  // Optional: the real route of a trip from GeoPulse (https://github.com/tess1o/geopulse).
  geopulse: z
    .object({
      url: z.url().transform((u) => u.replace(/\/+$/, "").replace(/\/api\/v1$/, "")),
      apiKey: z.string().min(1, "geopulse.apiKey fehlt"),
      // Leaves out the route this close to the start and end of a trip (e.g. home).
      privacyRadiusMeters: z.number().int().min(0).default(1000),
    })
    .optional(),
});

export type Config = z.infer<typeof ConfigSchema>;
export type ConfigInput = z.input<typeof ConfigSchema>;

export function parseConfig(raw: unknown): Config {
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Ungültige Konfiguration:\n${issues}`);
  }
  return result.data;
}

/**
 * Loads the YAML config file and applies environment overrides:
 *  MEDIATIMELINE_CONFIG                path of the config file (default /config/config.yaml)
 *  MEDIATIMELINE_IMMICH_URL            overrides immich.url
 *  MEDIATIMELINE_IMMICH_API_KEY        overrides immich.apiKey
 *  MEDIATIMELINE_IMMICH_API_KEY_FILE   reads immich.apiKey from a file (e.g. a Podman secret)
 *  MEDIATIMELINE_GEOPULSE_URL          overrides geopulse.url
 *  MEDIATIMELINE_GEOPULSE_API_KEY      overrides geopulse.apiKey
 *  MEDIATIMELINE_GEOPULSE_API_KEY_FILE reads geopulse.apiKey from a file
 *  MEDIATIMELINE_DATA_DIR / MEDIATIMELINE_STATIC_DIR / PORT
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const path = env.MEDIATIMELINE_CONFIG ?? "/config/config.yaml";
  let raw: Record<string, any> = {};
  if (existsSync(path)) {
    raw = (parseYaml(readFileSync(path, "utf8")) as Record<string, any>) ?? {};
  } else if (env.MEDIATIMELINE_CONFIG) {
    throw new Error(`Konfigurationsdatei nicht gefunden: ${path}`);
  }

  raw.immich ??= {};
  raw.server ??= {};
  if (env.MEDIATIMELINE_IMMICH_URL) raw.immich.url = env.MEDIATIMELINE_IMMICH_URL;
  if (env.MEDIATIMELINE_IMMICH_API_KEY_FILE) {
    raw.immich.apiKey = readFileSync(env.MEDIATIMELINE_IMMICH_API_KEY_FILE, "utf8").trim();
  }
  if (env.MEDIATIMELINE_IMMICH_API_KEY) raw.immich.apiKey = env.MEDIATIMELINE_IMMICH_API_KEY;
  if (env.MEDIATIMELINE_GEOPULSE_URL || env.MEDIATIMELINE_GEOPULSE_API_KEY || env.MEDIATIMELINE_GEOPULSE_API_KEY_FILE) {
    raw.geopulse ??= {};
    if (env.MEDIATIMELINE_GEOPULSE_URL) raw.geopulse.url = env.MEDIATIMELINE_GEOPULSE_URL;
    if (env.MEDIATIMELINE_GEOPULSE_API_KEY_FILE) {
      raw.geopulse.apiKey = readFileSync(env.MEDIATIMELINE_GEOPULSE_API_KEY_FILE, "utf8").trim();
    }
    if (env.MEDIATIMELINE_GEOPULSE_API_KEY) raw.geopulse.apiKey = env.MEDIATIMELINE_GEOPULSE_API_KEY;
  }
  if (env.MEDIATIMELINE_DATA_DIR) raw.server.dataDir = env.MEDIATIMELINE_DATA_DIR;
  if (env.MEDIATIMELINE_STATIC_DIR) raw.server.staticDir = env.MEDIATIMELINE_STATIC_DIR;
  if (env.PORT) raw.server.port = Number(env.PORT);

  return parseConfig(raw);
}
