import { mkdtempSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ShareStore } from "../src/store/db.js";

describe("share store migrations", () => {
  it("upgrades a version 2 database with the tour defaults", () => {
    const path = join(mkdtempSync(join(tmpdir(), "mt-db-")), "mediatimeline.db");
    new ShareStore(path).close();
    const db = new DatabaseSync(path);
    // Roll back migration 3 to simulate a database created by the previous release.
    db.exec(`CREATE TABLE old AS SELECT id, immich_album_id, token, title_override, enabled, expires_at,
               password_hash, password_version, created_at, created_by, caption_source, show_comments FROM shares;
             DROP TABLE shares; ALTER TABLE old RENAME TO shares;
             INSERT INTO shares (immich_album_id, token, enabled, password_version, created_at, caption_source, show_comments)
               VALUES ('album-1', 'tok2', 1, 0, '2026-01-01T00:00:00Z', 'firstComment', 1);
             PRAGMA user_version = 2;`);
    db.close();
    const store = new ShareStore(path);
    expect(store.getByToken("tok2")).toMatchObject({
      captionSource: "firstComment",
      showComments: true,
      tourIntervalSeconds: 5,
      tourRadiusMeters: 1000,
      tourVideoMaxSeconds: 30,
    });
    store.close();
  });

  it("upgrades a version 1 database and keeps existing links", () => {
    const path = join(mkdtempSync(join(tmpdir(), "mt-db-")), "mediatimeline.db");
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE shares (
      id INTEGER PRIMARY KEY AUTOINCREMENT, immich_album_id TEXT NOT NULL, token TEXT NOT NULL UNIQUE,
      title_override TEXT, enabled INTEGER NOT NULL DEFAULT 1, expires_at TEXT, password_hash TEXT,
      password_version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, created_by TEXT);
      CREATE INDEX shares_album ON shares(immich_album_id);
      INSERT INTO shares (immich_album_id, token, created_at) VALUES ('album-1', 'tok', '2026-01-01T00:00:00Z');
      PRAGMA user_version = 1;`);
    old.close();

    const store = new ShareStore(path);
    expect(store.getByToken("tok")).toMatchObject({
      albumId: "album-1",
      captionSource: "description",
      showComments: false,
      tourIntervalSeconds: 5,
      tourRadiusMeters: 1000,
      tourVideoMaxSeconds: 30,
    });
    expect(store.update(1, { captionSource: "firstComment", showComments: true })).toMatchObject({
      captionSource: "firstComment",
      showComments: true,
    });
    store.close();
  });
});
