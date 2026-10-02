import { mkdtempSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ShareStore } from "../src/store/db.js";

describe("share store migrations", () => {
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
    expect(store.getByToken("tok")).toMatchObject({ albumId: "album-1", captionSource: "description", showComments: false });
    expect(store.update(1, { captionSource: "firstComment", showComments: true })).toMatchObject({
      captionSource: "firstComment",
      showComments: true,
    });
    store.close();
  });
});
