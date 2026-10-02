#!/usr/bin/env node
// Records the guided tour of the demo timeline as MP4 for the project page.
//
//   record-tour.mjs <site dir>
//
// Serves the built site locally below BASE_PATH (like GitHub Pages), plays the
// tour in Chromium for a desktop and a phone viewport and captures it with the
// DevTools screencast (sharper than Playwright's own video). Writes to
// <site dir>/media: tour-<variant>.mp4/.jpg, timeline-desktop.jpg and og.jpg.
//
// Env: BASE_PATH (default /mediatimeline), PLAYWRIGHT_MODULE (import path of
// playwright), PLAYWRIGHT_CHANNEL (e.g. "chrome" – Playwright's Chromium
// cannot play H.264), MOCK_TILES (PNG served for every map tile, offline use).
// Needs ffmpeg.

import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";

const site = process.argv[2];
if (!site) throw new Error("usage: record-tour.mjs <site dir>");
const base = process.env.BASE_PATH ?? "/mediatimeline";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const ffmpeg = (...args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
const mediaDir = join(site, "media");
mkdirSync(mediaDir, { recursive: true });

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".mp4": "video/mp4",
  ".woff2": "font/woff2",
};

/** Minimal GitHub-Pages-like server: directory index, 404.html, Range requests. */
function serve() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (!url.pathname.startsWith(`${base}/`)) return void res.writeHead(404).end();
    let file = join(site, normalize(decodeURIComponent(url.pathname.slice(base.length))));
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) {
      res.writeHead(404, { "content-type": TYPES[".html"] });
      return void res.end(readFileSync(join(site, "404.html")));
    }
    const size = statSync(file).size;
    const type = TYPES[extname(file)] ?? "application/octet-stream";
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
    if (range) {
      const start = Number(range[1] || 0);
      const end = range[2] ? Number(range[2]) : size - 1;
      res.writeHead(206, { "content-type": type, "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1, "accept-ranges": "bytes" });
      return void createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { "content-type": type, "content-length": size, "accept-ranges": "bytes" });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const VARIANTS = [
  { name: "desktop", viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  { name: "phone", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
];

/** Turns screencast frames (JPEG + timestamp) into a constant-30-fps MP4. */
function encode(frames, endTime, file) {
  const dir = mkdtempSync(join(tmpdir(), "tour-frames-"));
  const lines = ["ffconcat version 1.0"];
  frames.forEach((f, i) => {
    const name = `f${String(i).padStart(6, "0")}.jpg`;
    writeFileSync(join(dir, name), Buffer.from(f.data, "base64"));
    const next = frames[i + 1]?.t ?? endTime;
    lines.push(`file '${name}'`, `duration ${Math.max(0.001, next - f.t).toFixed(4)}`);
  });
  // The concat demuxer ignores the last duration unless the file is repeated.
  lines.push(`file 'f${String(frames.length - 1).padStart(6, "0")}.jpg'`);
  writeFileSync(join(dir, "list.txt"), lines.join("\n"));
  ffmpeg(
    "-f", "concat", "-safe", "0", "-i", join(dir, "list.txt"),
    "-vf", "fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
    "-c:v", "libx264", "-preset", "slow", "-crf", "25", "-movflags", "+faststart", file,
  );
  rmSync(dir, { recursive: true, force: true });
}

async function record(origin, variant) {
  const { name, ...options } = variant;
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    // Without the flag the screencast delivers CSS pixels only.
    args: ["--autoplay-policy=no-user-gesture-required", "--hide-scrollbars", `--force-device-scale-factor=${options.deviceScaleFactor}`],
  });
  const context = await browser.newContext({ ...options, colorScheme: "light", locale: "de-DE", timezoneId: "Europe/Oslo" });
  // Headless fullscreen shrinks the page to an 800×600 screen; the tour covers the viewport anyway.
  await context.addInitScript(() => {
    Element.prototype.requestFullscreen = () => Promise.resolve();
  });
  if (process.env.MOCK_TILES) {
    const tile = readFileSync(process.env.MOCK_TILES);
    await context.route(/tile\.openstreetmap\.org/, (route) => route.fulfill({ body: tile, contentType: "image/png" }));
  }
  const page = await context.newPage();
  page.on("pageerror", (err) => console.warn(`[${name}] ${err}`));
  await page.goto(`${origin}${base}/demo/`);
  await page.waitForSelector(".start-tour");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  if (name === "desktop") {
    // Just the content column (880 px plus margin).
    const clip = { x: 160, y: 0, width: 960, height: 720 };
    await page.screenshot({ path: join(mediaDir, "timeline-desktop.jpg"), type: "jpeg", quality: 85, clip });
  }

  const cdp = await context.newCDPSession(page);
  const frames = [];
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    frames.push({ data, t: metadata.timestamp });
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await page.click(".start-tour");
  await page.waitForSelector(".tour");
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 90,
    maxWidth: options.viewport.width * options.deviceScaleFactor,
    maxHeight: options.viewport.height * options.deviceScaleFactor,
  });
  const started = Date.now() / 1000;
  // Poster: shortly after the first photo appears.
  await page.waitForSelector(".tour .media img", { timeout: 60_000 });
  const posterAt = Date.now() / 1000 - started + 1.2;
  await page.waitForSelector(".tour", { state: "detached", timeout: 600_000 });
  const ended = Date.now() / 1000;
  await cdp.send("Page.stopScreencast");
  await browser.close();

  if (frames.length < 10) throw new Error(`[${name}] only ${frames.length} frames captured`);
  // Screencast timestamps share the wall clock; drop frames from before the start.
  const tour = frames.filter((f) => f.t >= started - 0.5);
  const video = join(mediaDir, `tour-${name}.mp4`);
  encode(tour, ended, video);
  ffmpeg("-ss", posterAt.toFixed(2), "-i", video, "-frames:v", "1", "-q:v", "3", join(mediaDir, `tour-${name}.jpg`));
  console.log(`${name}: ${tour.length} Frames, ${(ended - started).toFixed(0)} s, ${(statSync(video).size / 1e6).toFixed(1)} MB`);
}

const server = await serve();
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  for (const variant of VARIANTS) await record(origin, variant);
  // Link preview image (1200×630) from the desktop poster.
  ffmpeg("-i", join(mediaDir, "tour-desktop.jpg"), "-vf", "scale=1200:630:force_original_aspect_ratio=increase,crop=1200:630", "-q:v", "3", join(mediaDir, "og.jpg"));
} finally {
  server.close();
}
