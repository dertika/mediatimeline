// Minimal Immich API for the iOS UI tests: one album with photos in Norway,
// rendered as PNG gradients so they show up in screenshots. API key "dev".
import { createServer } from "node:http";
import { deflateSync } from "node:zlib";

const port = Number(process.env.PORT ?? 9999);
const ALBUM = "album-1";

const asset = (id, local, lat, lng, city, desc, colors, extra = {}) => ({
  id,
  type: "IMAGE",
  fileCreatedAt: local,
  localDateTime: local,
  isTrashed: false,
  isFavorite: false,
  width: 1600,
  height: 1200,
  exifInfo: {
    dateTimeOriginal: local,
    latitude: lat,
    longitude: lng,
    city,
    country: city ? "Norwegen" : null,
    description: desc,
  },
  colors,
  ...extra,
});

const assets = [
  asset("p1", "2026-06-01T09:00:00.000Z", 60.3975, 5.3242, "Bergen", "Bryggen am Morgen", ["#f59e0b", "#b45309"], { isFavorite: true }),
  asset("p1b", "2026-06-01T10:30:00.000Z", 60.3925, 5.3221, "Bergen", null, ["#38bdf8", "#1e3a8a"], { width: 1200, height: 1600 }),
  asset("nx", "2026-06-02T08:00:00.000Z", null, null, null, null, ["#a3a3a3", "#404040"]),
  asset("p2", "2026-06-02T14:00:00.000Z", 62.1015, 7.2059, "Geiranger", "Geirangerfjord", ["#34d399", "#065f46"]),
  asset("p3", "2026-06-02T15:00:00.000Z", 62.1049, 7.0941, "Geiranger", null, ["#a78bfa", "#4c1d95"]),
  asset("p4", "2026-06-03T18:30:00.000Z", 59.9139, 10.7522, "Oslo", "Oper von Oslo", ["#f472b6", "#831843"]),
];

const activities = [
  { id: "c1", createdAt: "2026-06-04T10:00:00.000Z", type: "comment", assetId: null, comment: "Was für eine Reise!", user: { name: "Anna" } },
  { id: "c2", createdAt: "2026-06-04T11:00:00.000Z", type: "comment", assetId: "p2", comment: "Da will ich auch hin.", user: { name: "Ben" } },
  { id: "l1", createdAt: "2026-06-04T12:00:00.000Z", type: "like", assetId: "p2", user: { name: "Anna" } },
];

const album = {
  id: ALBUM,
  albumName: "Norwegen 2026",
  description: "Mit dem Auto und dem Schiff durch die Fjorde.",
  assetCount: assets.length,
  albumThumbnailAssetId: "p1",
  startDate: assets[0].localDateTime,
  endDate: assets.at(-1).localDateTime,
  updatedAt: "2026-06-04T12:00:00.000Z",
};

// --- PNG ----------------------------------------------------------------
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** Diagonal gradient with a light "sun" – enough to tell photos apart. */
function png(width, height, [from, to]) {
  const a = hex(from);
  const b = hex(to);
  const raw = Buffer.alloc((width * 3 + 1) * height);
  const sun = { x: width * 0.72, y: height * 0.3, r: Math.min(width, height) * 0.12 };
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const t = (x / width + y / height) / 2;
      let px = a.map((v, i) => Math.round(v + (b[i] - v) * t));
      if ((x - sun.x) ** 2 + (y - sun.y) ** 2 < sun.r ** 2) px = [255, 250, 235];
      raw.set(px, row + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const images = new Map();
function image(a, size) {
  const key = `${a.id}:${size}`;
  if (!images.has(key)) {
    const long = size === "preview" ? 1440 : 250;
    const [w, h] = a.width >= a.height ? [long, Math.round((long * a.height) / a.width)] : [Math.round((long * a.width) / a.height), long];
    images.set(key, png(w, h, a.colors));
  }
  return images.get(key);
}

// --- HTTP ---------------------------------------------------------------
const publicAsset = ({ colors: _c, ...a }) => a;
const json = (res, body, status = 200) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.headers["x-api-key"] !== "dev") return json(res, { message: "unauthorized" }, 401);
  const path = url.pathname;
  if (path === "/api/server/ping") return json(res, { res: "pong" });
  if (path === "/api/albums") return json(res, [album]);
  if (path === `/api/albums/${ALBUM}`) return json(res, album);
  if (path === "/api/search/metadata" && req.method === "POST") {
    return json(res, { assets: { items: assets.map(publicAsset), nextPage: null } });
  }
  if (path === "/api/activities") return json(res, activities);
  const thumb = path.match(/^\/api\/assets\/([^/]+)\/thumbnail$/);
  const a = thumb && assets.find((x) => x.id === thumb[1]);
  if (a) {
    res.writeHead(200, { "content-type": "image/png", "cache-control": "private, max-age=86400" });
    return res.end(image(a, url.searchParams.get("size") ?? "thumbnail"));
  }
  json(res, { message: "not found" }, 404);
}).listen(port, "127.0.0.1", () => console.log(`Immich mock on :${port}`));
