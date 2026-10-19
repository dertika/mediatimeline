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

  it("has a 15 s geocoder timeout that can be changed within 1 to 60", () => {
    const base = { immich: { url: "https://immich.example.com", apiKey: "k" } };
    expect(parseConfig(base).geocoder.timeoutSeconds).toBe(15);
    expect(parseConfig({ ...base, geocoder: { timeoutSeconds: 30 } }).geocoder.timeoutSeconds).toBe(30);
    expect(() => parseConfig({ ...base, geocoder: { timeoutSeconds: 0 } })).toThrow();
    expect(() => parseConfig({ ...base, geocoder: { timeoutSeconds: 61 } })).toThrow();
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

  it("has no proxy secret by default and takes one from the environment or a file", () => {
    const dir = mkdtempSync(join(tmpdir(), "mt-"));
    const path = join(dir, "config.yaml");
    writeFileSync(path, "immich:\n  url: https://a.example\n  apiKey: k\n");
    writeFileSync(join(dir, "proxy"), "f".repeat(32) + "\n");

    const plain = loadConfig({ MEDIATIMELINE_CONFIG: path });
    expect(plain.admin.proxySecret).toBeUndefined();
    expect(plain.admin.proxySecretHeader).toBe("X-Proxy-Auth");
    expect(loadConfig({ MEDIATIMELINE_CONFIG: path, MEDIATIMELINE_PROXY_SECRET_FILE: join(dir, "proxy") }).admin.proxySecret).toBe(
      "f".repeat(32),
    );
    expect(loadConfig({ MEDIATIMELINE_CONFIG: path, MEDIATIMELINE_PROXY_SECRET: "e".repeat(32) }).admin.proxySecret).toBe("e".repeat(32));
  });

  it("refuses a proxy secret shorter than 32 characters", () => {
    expect(() => parseConfig({ immich: { url: "https://a.example", apiKey: "k" }, admin: { proxySecret: "kurz" } })).toThrow(
      /admin\.proxySecret/,
    );
  });

  describe("OpenID Connect", () => {
    const base = { immich: { url: "https://i.example", apiKey: "k" }, server: { publicBaseUrl: "https://t.example" } };
    const oidc = { issuer: "https://id.example/", clientId: "mt", clientSecret: "s" };

    it("is off by default and has defaults when it is set", () => {
      expect(parseConfig(base).admin.oidc).toBeUndefined();
      const config = parseConfig({ ...base, admin: { oidc } });
      expect(config.admin.oidc).toEqual({
        issuer: "https://id.example",
        clientId: "mt",
        clientSecret: "s",
        scopes: ["openid", "profile", "email", "groups"],
        usernameClaim: "preferred_username",
        groupsClaim: "groups",
        sessionHours: 12,
      });
    });

    it("needs server.publicBaseUrl for the return address", () => {
      expect(() => parseConfig({ immich: base.immich, admin: { oidc } })).toThrow(/publicBaseUrl/);
    });

    it("accepts http only for a provider on this machine", () => {
      expect(() => parseConfig({ ...base, admin: { oidc: { ...oidc, issuer: "http://id.example" } } })).toThrow(/admin\.oidc\.issuer/);
      expect(parseConfig({ ...base, admin: { oidc: { ...oidc, issuer: "http://127.0.0.1:9000" } } }).admin.oidc?.issuer).toBe(
        "http://127.0.0.1:9000",
      );
    });

    it("reads the client secret from the environment or a file", () => {
      const dir = mkdtempSync(join(tmpdir(), "mt-"));
      const path = join(dir, "config.yaml");
      writeFileSync(
        path,
        "immich:\n  url: https://a.example\n  apiKey: k\nserver:\n  publicBaseUrl: https://t.example\nadmin:\n  oidc:\n    issuer: https://id.example\n    clientId: mt\n",
      );
      writeFileSync(join(dir, "secret"), "from-file\n");
      expect(loadConfig({ MEDIATIMELINE_CONFIG: path }).admin.oidc?.clientSecret).toBeUndefined();
      expect(loadConfig({ MEDIATIMELINE_CONFIG: path, MEDIATIMELINE_OIDC_CLIENT_SECRET_FILE: join(dir, "secret") }).admin.oidc?.clientSecret).toBe("from-file");
      expect(loadConfig({ MEDIATIMELINE_CONFIG: path, MEDIATIMELINE_OIDC_CLIENT_SECRET: "from-env" }).admin.oidc?.clientSecret).toBe("from-env");
    });
  });
});
