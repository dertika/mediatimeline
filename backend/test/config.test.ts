import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, parseConfig } from "../src/config.js";

describe("config", () => {
  it("applies defaults and normalises the Immich URL", () => {
    const config = parseConfig({ immich: { url: "https://immich.example.com/", apiKey: "k" } });
    expect(config.immich.url).toBe("https://immich.example.com");
    expect(config.server.port).toBe(8080);
    expect(config.admin.userHeader).toBe("Remote-User");
    expect(config.cache.albumTtlSeconds).toBe(300);
  });

  it("fails with a readable message when required values are missing", () => {
    expect(() => parseConfig({ immich: { url: "nope" } })).toThrow(/immich\.url[\s\S]*immich\.apiKey/);
  });

  it("loads YAML and lets the environment override secrets", () => {
    const dir = mkdtempSync(join(tmpdir(), "mt-"));
    const path = join(dir, "config.yaml");
    writeFileSync(path, "immich:\n  url: https://a.example\n  apiKey: from-file\nserver:\n  port: 9000\n");
    writeFileSync(join(dir, "secret"), "from-secret\n");

    expect(loadConfig({ MEDIATIMELINE_CONFIG: path }).immich.apiKey).toBe("from-file");
    const config = loadConfig({ MEDIATIMELINE_CONFIG: path, MEDIATIMELINE_IMMICH_API_KEY_FILE: join(dir, "secret") });
    expect(config.immich.apiKey).toBe("from-secret");
    expect(config.server.port).toBe(9000);
    expect(config.geopulse).toBeUndefined();

    const withGeoPulse = loadConfig({
      MEDIATIMELINE_CONFIG: path,
      MEDIATIMELINE_GEOPULSE_URL: "http://geopulse:8080/api/",
      MEDIATIMELINE_GEOPULSE_API_KEY_FILE: join(dir, "secret"),
    });
    expect(withGeoPulse.geopulse).toEqual({ url: "http://geopulse:8080", apiKey: "from-secret", privacyRadiusMeters: 1000 });
  });
});
