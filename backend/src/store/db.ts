import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface Share {
  id: number;
  albumId: string;
  token: string;
  titleOverride: string | null;
  enabled: boolean;
  expiresAt: string | null;
  passwordHash: string | null;
  /** Incremented whenever the password changes; invalidates existing unlock cookies. */
  passwordVersion: number;
  createdAt: string;
  createdBy: string | null;
}

interface ShareRow {
  id: number;
  immich_album_id: string;
  token: string;
  title_override: string | null;
  enabled: number;
  expires_at: string | null;
  password_hash: string | null;
  password_version: number;
  created_at: string;
  created_by: string | null;
}

const MIGRATIONS = [
  `CREATE TABLE shares (
     id               INTEGER PRIMARY KEY AUTOINCREMENT,
     immich_album_id  TEXT NOT NULL,
     token            TEXT NOT NULL UNIQUE,
     title_override   TEXT,
     enabled          INTEGER NOT NULL DEFAULT 1,
     expires_at       TEXT,
     password_hash    TEXT,
     password_version INTEGER NOT NULL DEFAULT 0,
     created_at       TEXT NOT NULL,
     created_by       TEXT
   );
   CREATE INDEX shares_album ON shares(immich_album_id);`,
];

function fromRow(r: ShareRow): Share {
  return {
    id: r.id,
    albumId: r.immich_album_id,
    token: r.token,
    titleOverride: r.title_override,
    enabled: r.enabled === 1,
    expiresAt: r.expires_at,
    passwordHash: r.password_hash,
    passwordVersion: r.password_version,
    createdAt: r.created_at,
    createdBy: r.created_by,
  };
}

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface ShareUpdate {
  enabled?: boolean;
  titleOverride?: string | null;
  expiresAt?: string | null;
  passwordHash?: string | null;
}

export class ShareStore {
  private db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate(): void {
    const { user_version: version } = this.db.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    for (let v = version; v < MIGRATIONS.length; v++) {
      this.db.exec("BEGIN");
      try {
        this.db.exec(MIGRATIONS[v]!);
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
        this.db.exec("COMMIT");
      } catch (err) {
        this.db.exec("ROLLBACK");
        throw err;
      }
    }
  }

  list(): Share[] {
    const rows = this.db.prepare("SELECT * FROM shares ORDER BY created_at, id").all();
    return (rows as unknown as ShareRow[]).map(fromRow);
  }

  get(id: number): Share | undefined {
    const row = this.db.prepare("SELECT * FROM shares WHERE id = ?").get(id);
    return row ? fromRow(row as unknown as ShareRow) : undefined;
  }

  getByToken(token: string): Share | undefined {
    const row = this.db.prepare("SELECT * FROM shares WHERE token = ?").get(token);
    return row ? fromRow(row as unknown as ShareRow) : undefined;
  }

  create(albumId: string, createdBy: string | null): Share {
    const res = this.db
      .prepare(
        "INSERT INTO shares (immich_album_id, token, created_at, created_by) VALUES (?, ?, ?, ?)",
      )
      .run(albumId, generateToken(), new Date().toISOString(), createdBy);
    return this.get(Number(res.lastInsertRowid))!;
  }

  update(id: number, patch: ShareUpdate): Share | undefined {
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    if (patch.enabled !== undefined) {
      sets.push("enabled = ?");
      values.push(patch.enabled ? 1 : 0);
    }
    if (patch.titleOverride !== undefined) {
      sets.push("title_override = ?");
      values.push(patch.titleOverride);
    }
    if (patch.expiresAt !== undefined) {
      sets.push("expires_at = ?");
      values.push(patch.expiresAt);
    }
    if (patch.passwordHash !== undefined) {
      sets.push("password_hash = ?", "password_version = password_version + 1");
      values.push(patch.passwordHash);
    }
    if (sets.length > 0) {
      this.db.prepare(`UPDATE shares SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
    }
    return this.get(id);
  }

  delete(id: number): boolean {
    return this.db.prepare("DELETE FROM shares WHERE id = ?").run(id).changes > 0;
  }

  close(): void {
    this.db.close();
  }
}
