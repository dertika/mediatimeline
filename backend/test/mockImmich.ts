import Fastify from "fastify";
import type { ImmichAlbum, ImmichAsset } from "../src/immich/client.js";

export const API_KEY = "test-key";

const asset = (
  id: string,
  type: ImmichAsset["type"],
  taken: string,
  extra: Partial<NonNullable<ImmichAsset["exifInfo"]>> = {},
): ImmichAsset => ({
  id,
  type,
  fileCreatedAt: taken,
  localDateTime: taken.replace("Z", ".000Z"),
  exifInfo: { dateTimeOriginal: taken, exifImageWidth: 4000, exifImageHeight: 3000, ...extra },
});

export const albums: (ImmichAlbum & { assets: ImmichAsset[] })[] = [
  {
    id: "album-1",
    albumName: "Norwegen 2026",
    description: "Roadtrip",
    assetCount: 4,
    albumThumbnailAssetId: "a2",
    startDate: "2026-06-01T08:00:00Z",
    endDate: "2026-06-03T18:00:00Z",
    assets: [
      asset("a3", "IMAGE", "2026-06-03T18:00:00Z", { description: "Abschied", latitude: 59.9, longitude: 10.7 }),
      asset("a1", "IMAGE", "2026-06-01T08:00:00Z", { description: "  Ankunft  ", latitude: 60.4, longitude: 5.3 }),
      asset("a2", "VIDEO", "2026-06-02T12:00:00Z", { orientation: "6" }),
      { ...asset("a4", "IMAGE", "2026-06-02T13:00:00Z"), isTrashed: true },
    ],
  },
  { id: "album-2", albumName: "Privat", assetCount: 1, assets: [asset("b1", "IMAGE", "2026-01-01T00:00:00Z")] },
];

export async function startMockImmich() {
  const app = Fastify();
  const requests: { url: string; headers: Record<string, unknown> }[] = [];

  app.addHook("onRequest", async (req, reply) => {
    requests.push({ url: req.url, headers: req.headers });
    if (req.headers["x-api-key"] !== API_KEY) return reply.code(401).send({ message: "unauthorized" });
  });

  app.get("/api/server/ping", async () => ({ res: "pong" }));
  app.get("/api/albums", async () => albums.map(({ assets: _a, ...rest }) => rest));
  app.get<{ Params: { id: string } }>("/api/albums/:id", async (req, reply) => {
    const album = albums.find((a) => a.id === req.params.id);
    if (!album) return reply.code(400).send({ message: "Not found or no album.read access" });
    const { assets, ...rest } = album;
    return (req.query as Record<string, string>).withoutAssets === "true" ? rest : { ...rest, assets };
  });
  app.post<{ Body: { albumIds: string[]; page: number; size: number } }>(
    "/api/search/metadata",
    async (req) => {
      const album = albums.find((a) => a.id === req.body.albumIds[0]);
      const all = album?.assets ?? [];
      const start = (req.body.page - 1) * 2; // tiny page size to exercise pagination
      const items = all.slice(start, start + 2);
      const nextPage = start + 2 < all.length ? String(req.body.page + 1) : null;
      return { assets: { items, nextPage, total: items.length, count: items.length } };
    },
  );
  app.get<{ Params: { id: string } }>("/api/assets/:id/thumbnail", async (req, reply) => {
    const size = (req.query as Record<string, string>).size;
    reply.header("content-type", "image/webp").header("etag", `"${req.params.id}-${size}"`);
    if (req.headers["if-none-match"] === `"${req.params.id}-${size}"`) return reply.code(304).send();
    return `${req.params.id}:${size}`;
  });
  app.get<{ Params: { id: string } }>("/api/assets/:id/video/playback", async (req, reply) => {
    const body = Buffer.from("0123456789");
    const range = req.headers.range;
    reply.header("content-type", "video/mp4").header("accept-ranges", "bytes");
    if (range) {
      const [s, e] = range.replace("bytes=", "").split("-").map(Number);
      const end = Number.isNaN(e) ? body.length - 1 : e!;
      return reply
        .code(206)
        .header("content-range", `bytes ${s}-${end}/${body.length}`)
        .send(body.subarray(s, end + 1));
    }
    return reply.send(body);
  });

  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { app, url: `http://127.0.0.1:${port}`, requests };
}
