import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CaptionSource } from "../caption.js";

/** A place picked in the admin, e.g. the start of a trip. */
export interface Place {
  name: string;
  lat: number;
  lng: number;
}

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
  captionSource: CaptionSource;
  showComments: boolean;
  tourIntervalSeconds: number;
  tourRadiusMeters: number;
  /** Maximum playback time of a video in the tour; 0 = whole video. */
  tourVideoMaxSeconds: number;
  /** Where the trip starts and ends, shown on the map and in the tour without photos. */
  tripStart: Place | null;
  tripEnd: Place | null;
  /** Round trip: the end is the start, also after the start changes. */
  tripEndSameAsStart: boolean;
  /** Show the real route from GeoPulse instead of straight lines between the photos. */
  showRoute: boolean;
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
  caption_source: string;
  show_comments: number;
  tour_interval_seconds: number;
  tour_radius_meters: number;
  tour_video_max_seconds: number;
  trip_start: string | null;
  trip_end: string | null;
  trip_end_same: number;
  show_route: number;
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
  `ALTER TABLE shares ADD COLUMN caption_source TEXT NOT NULL DEFAULT 'description';
   ALTER TABLE shares ADD COLUMN show_comments INTEGER NOT NULL DEFAULT 0;`,
  `ALTER TABLE shares ADD COLUMN tour_interval_seconds INTEGER NOT NULL DEFAULT 5;
   ALTER TABLE shares ADD COLUMN tour_radius_meters INTEGER NOT NULL DEFAULT 1000;
   ALTER TABLE shares ADD COLUMN tour_video_max_seconds INTEGER NOT NULL DEFAULT 30;`,
  `ALTER TABLE shares ADD COLUMN trip_start TEXT;
   ALTER TABLE shares ADD COLUMN trip_end TEXT;
   ALTER TABLE shares ADD COLUMN trip_end_same INTEGER NOT NULL DEFAULT 0;`,
  `ALTER TABLE shares ADD COLUMN show_route INTEGER NOT NULL DEFAULT 0;`,
];

const placeFromJson = (json: string | null): Place | null => (json ? (JSON.parse(json) as Place) : null);

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
    captionSource: r.caption_source as CaptionSource,
    showComments: r.show_comments === 1,
    tourIntervalSeconds: r.tour_interval_seconds,
    tourRadiusMeters: r.tour_radius_meters,
    tourVideoMaxSeconds: r.tour_video_max_seconds,
    tripStart: placeFromJson(r.trip_start),
    tripEnd: placeFromJson(r.trip_end),
    tripEndSameAsStart: r.trip_end_same === 1,
    showRoute: r.show_route === 1,
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
  captionSource?: CaptionSource;
  showComments?: boolean;
  tourIntervalSeconds?: number;
  tourRadiusMeters?: number;
  tourVideoMaxSeconds?: number;
  tripStart?: Place | null;
  tripEnd?: Place | null;
  tripEndSameAsStart?: boolean;
  showRoute?: boolean;
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
    if (patch.captionSource !== undefined) {
      sets.push("caption_source = ?");
      values.push(patch.captionSource);
    }
    if (patch.showComments !== undefined) {
      sets.push("show_comments = ?");
      values.push(patch.showComments ? 1 : 0);
    }
    for (const [key, column] of [
      ["tourIntervalSeconds", "tour_interval_seconds"],
      ["tourRadiusMeters", "tour_radius_meters"],
      ["tourVideoMaxSeconds", "tour_video_max_seconds"],
    ] as const) {
      if (patch[key] !== undefined) {
        sets.push(`${column} = ?`);
        values.push(patch[key]);
      }
    }
    for (const [key, column] of [
      ["tripStart", "trip_start"],
      ["tripEnd", "trip_end"],
    ] as const) {
      if (patch[key] !== undefined) {
        sets.push(`${column} = ?`);
        values.push(patch[key] && JSON.stringify(patch[key]));
      }
    }
    if (patch.tripEndSameAsStart !== undefined) {
      sets.push("trip_end_same = ?");
      values.push(patch.tripEndSameAsStart ? 1 : 0);
    }
    if (patch.showRoute !== undefined) {
      sets.push("show_route = ?");
      values.push(patch.showRoute ? 1 : 0);
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
