#!/usr/bin/env node
// Builds the demo timeline of the GitHub Pages site from site/trip.json.
//
// Photos (and one video) come from Wikimedia Commons: for every place the
// script looks for freely licensed files taken nearby and uses their real
// coordinates. A photo or video can be pinned with "file": "File:….jpg".
// Output, below the directory given as the first argument:
//   timeline.json            same shape as /api/public/timeline/<token>
//   credits.json             author and license of every file
//   media/<id>/thumbnail.jpg, preview.jpg (and video.mp4)
//
// DEMO_OFFLINE=1 generates placeholder images instead (no network needed).
// Needs ffmpeg.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2];
if (!out) throw new Error("usage: demo-data.mjs <output dir>");
const offline = process.env.DEMO_OFFLINE === "1";
const trip = JSON.parse(readFileSync(join(here, "..", "trip.json"), "utf8"));

const API = process.env.COMMONS_API ?? "https://commons.wikimedia.org/w/api.php";
const USER_AGENT = "mediatimeline-demo-build/1.0 (https://github.com/dertika/mediatimeline)";
const LICENSE_OK = /^(cc0|cc[- ]by(-sa)?[- ]\d|public domain|pd\b)/i;
const UNWANTED = /map|karte|kart\b|logo|plan\b|diagram|sign|skilt|interior|inside|museum|statue|plaque|ticket|menu|panorama|aerial|drone|night|cruise|ship|ferry|hurtigruten|explorer|butterfly|panoramio|wasp|insect|beetle|\bbird|flower|departing|arriving|\bbow\b|\bstern\b|polarlys|zeiss|instrument|close-up/i;
/** Ship names and prefixes, Latin species names in brackets: "(Parnassius mnemosyne)". */
const UNWANTED_EXACT = /\b(IMO|AIDA\w*|Costa|MSC?|MV|CMV)\b|\([A-Z][a-z]+ (sp\.|[a-z]+)\)/;
const QUALITY_CATEGORIES = [
  "Category:Featured pictures on Wikimedia Commons",
  "Category:Quality images",
  "Category:Valued images sorted by promotion date",
];
/** Norway in summer (CEST): local wall-clock time minus two hours. */
const UTC_OFFSET_HOURS = 2;

const ffmpeg = (...args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stripHtml = (s) =>
  (s ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

async function get(url, as = "json") {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return as === "json" ? await res.json() : Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt >= 4) throw err;
      await sleep(1000 * 2 ** attempt);
    }
  }
}

const api = (params) =>
  get(`${API}?${new URLSearchParams({ format: "json", formatversion: "2", ...params })}`).then((r) => {
    if (r.error) throw new Error(`Commons API: ${r.error.info}`);
    return r;
  });

/** File details for up to 50 pages, as candidates. */
async function details(selector) {
  const r = await api({
    action: "query",
    ...selector,
    prop: "imageinfo|categories|coordinates",
    iiprop: "url|size|mime|extmetadata",
    // Wikimedia serves standard thumbnail widths (…, 1280, 1920) best.
    iiurlwidth: "1920",
    iiextmetadatafilter: "LicenseShortName|LicenseUrl|Artist",
    clcategories: QUALITY_CATEGORIES.join("|"),
    cllimit: "max",
  });
  return (r.query?.pages ?? [])
    .filter((p) => p.imageinfo?.[0])
    .map((p) => {
      const info = p.imageinfo[0];
      const meta = info.extmetadata ?? {};
      return {
        title: p.title,
        // Camera position; geosearch hits replace it with their own coordinates.
        lat: p.coordinates?.[0]?.lat,
        lng: p.coordinates?.[0]?.lon,
        pageUrl: info.descriptionurl,
        url: info.url,
        mime: info.mime,
        width: info.width,
        height: info.height,
        thumbUrl: info.thumburl,
        thumbWidth: info.thumbwidth,
        thumbHeight: info.thumbheight,
        license: stripHtml(meta.LicenseShortName?.value),
        licenseUrl: meta.LicenseUrl?.value ?? null,
        artist: stripHtml(meta.Artist?.value) || "unbekannt",
        quality: QUALITY_CATEGORIES.length - Math.min(
          ...((p.categories ?? []).map((c) => QUALITY_CATEGORIES.indexOf(c.title)).filter((i) => i >= 0)),
          QUALITY_CATEGORIES.length,
        ),
      };
    });
}

/** Files near a place with their coordinates, best first. */
async function nearby(place) {
  const r = await api({
    action: "query",
    list: "geosearch",
    gscoord: `${place.lat}|${place.lng}`,
    gsradius: String(Math.min(10000, place.radius ?? 2000)),
    gsnamespace: "6",
    gslimit: "max",
  });
  const hits = r.query?.geosearch ?? [];
  const files = [];
  for (let i = 0; i < hits.length; i += 50) {
    const pageids = hits.slice(i, i + 50).map((h) => h.pageid).join("|");
    for (const f of await details({ pageids })) {
      const hit = hits.find((h) => h.title === f.title);
      if (hit) files.push({ ...f, lat: hit.lat, lng: hit.lon, dist: hit.dist });
    }
  }
  return files
    .filter((f) => LICENSE_OK.test(f.license) && !UNWANTED.test(f.title) && !UNWANTED_EXACT.test(f.title))
    // Titles naming the place mostly show the place itself, not objects found there.
    .map((f) => ({ ...f, named: [place.name, place.city].some((n) => f.title.includes(n)) ? 1 : 0 }))
    .sort((a, b) => b.named - a.named || b.quality - a.quality || a.dist - b.dist);
}

const isPhoto = (f) =>
  f.mime === "image/jpeg" && f.width >= 1800 && f.width / f.height >= 1.3 && f.width / f.height <= 1.85;
const isVideo = (f) => f.mime?.startsWith("video/");

async function pinned(title, place) {
  const [f] = await details({ titles: title });
  if (!f) throw new Error(`pinned file not found: ${title}`);
  // A pinned file without coordinates sits at the place itself.
  return { ...f, lat: f.lat ?? place.lat, lng: f.lng ?? place.lng };
}

/** Picks `count` files, preferring different photographers. */
function pick(files, count, used) {
  const chosen = [];
  const artists = new Set();
  for (const strict of [true, false]) {
    for (const f of files) {
      if (chosen.length >= count) break;
      if (used.has(f.title) || chosen.includes(f) || (strict && artists.has(f.artist))) continue;
      chosen.push(f);
      artists.add(f.artist);
    }
  }
  for (const f of chosen) used.add(f.title);
  return chosen;
}

function localIso(time) {
  return `${time}:00.000Z`;
}

function takenAtIso(time) {
  return new Date(Date.parse(localIso(time)) - UTC_OFFSET_HOURS * 3600_000).toISOString();
}

function writeThumbnail(dir) {
  ffmpeg("-i", join(dir, "preview.jpg"), "-vf", "scale=480:-2", "-q:v", "4", join(dir, "thumbnail.jpg"));
}

const COLORS = ["#2f6f5e", "#3d6fa8", "#b5653c", "#7a5ea8", "#a83d5e", "#4f8a3b"];

function placeholderImage(dir, seed) {
  const [c0, c1] = [COLORS[seed % COLORS.length], COLORS[(seed + 2) % COLORS.length]];
  ffmpeg("-f", "lavfi", "-i", `gradients=s=1600x1067:c0=${c0}:c1=${c1}:seed=${seed}:d=1`, "-frames:v", "1", "-q:v", "3", join(dir, "preview.jpg"));
}

/** Short H.264 clip (max. 10 s, 1280 px) plus poster frames. */
function encodeVideo(input, inputArgs, dir) {
  ffmpeg(
    ...inputArgs,
    "-i",
    input,
    "-t",
    "10",
    "-vf",
    "scale='min(1280,iw)':-2,format=yuv420p",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "26",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    join(dir, "video.mp4"),
  );
  ffmpeg("-ss", "1", "-i", join(dir, "video.mp4"), "-frames:v", "1", "-q:v", "3", join(dir, "preview.jpg"));
  writeThumbnail(dir);
}

/** A slow pan over a photo, used when no free video is found nearby. */
function panVideo(photoDir, dir) {
  ffmpeg(
    "-loop",
    "1",
    "-i",
    join(photoDir, "preview.jpg"),
    "-vf",
    "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080," +
      "zoompan=z='1+0.0006*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=30,format=yuv420p",
    "-t",
    "8",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "24",
    "-movflags",
    "+faststart",
    join(dir, "video.mp4"),
  );
  ffmpeg("-ss", "1", "-i", join(dir, "video.mp4"), "-frames:v", "1", "-q:v", "3", join(dir, "preview.jpg"));
  writeThumbnail(dir);
}

async function main() {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "media"), { recursive: true });
  const assets = [];
  const credits = [];
  const used = new Set();
  let n = 0;

  const asset = (id, type, time, place, file, extra) => ({
    id,
    type,
    takenAt: takenAtIso(time),
    localDateTime: localIso(time),
    caption: extra.caption ?? null,
    comments: (extra.comments ?? []).map((c, i) => ({
      ...c,
      createdAt: new Date(Date.parse(takenAtIso(time)) + (i + 1) * 3600_000).toISOString(),
    })),
    lat: file.lat,
    lng: file.lng,
    width: file.width,
    height: file.height,
    city: place.city,
    country: place.country,
  });

  for (const [p, place] of trip.places.entries()) {
    let files = [];
    if (!offline) {
      files = await nearby(place);
      console.log(`${place.name}: ${files.filter(isPhoto).length} Fotos, ${files.filter(isVideo).length} Videos in der Nähe`);
    }
    // Pinned files first, so that the automatic pick cannot choose them again.
    const pins = new Map();
    for (const photo of offline ? [] : place.photos.filter((ph) => ph.file)) {
      pins.set(photo, await pinned(photo.file, place));
      used.add(photo.file);
    }
    const photos = offline ? [] : pick(files.filter(isPhoto), place.photos.length - pins.size, used);
    let firstPhotoDir = null;

    for (const [i, photo] of place.photos.entries()) {
      const id = `p${String(++n).padStart(2, "0")}`;
      const dir = join(out, "media", id);
      mkdirSync(dir, { recursive: true });
      let file;
      if (offline) {
        placeholderImage(dir, n);
        file = { lat: place.lat + (i - 1) * 0.002, lng: place.lng + (i % 2) * 0.003, width: 1600, height: 1067 };
      } else {
        file = pins.get(photo) ?? photos.shift();
        if (!file) throw new Error(`${place.name}: nicht genug freie Fotos gefunden – Datei in trip.json festlegen`);
        writeFileSync(join(dir, "original.jpg"), await get(file.thumbUrl, "buffer"));
        ffmpeg("-i", join(dir, "original.jpg"), "-vf", "scale=1600:-2", "-q:v", "3", join(dir, "preview.jpg"));
        rmSync(join(dir, "original.jpg"));
        file = { ...file, width: 1600, height: Math.round((1600 * file.thumbHeight) / file.thumbWidth / 2) * 2 };
        credits.push({ id, title: file.title, url: file.pageUrl, artist: file.artist, license: file.license, licenseUrl: file.licenseUrl });
        console.log(`  ${id} ${file.title} (${file.license}, ${file.artist})`);
      }
      writeThumbnail(dir);
      firstPhotoDir ??= dir;
      assets.push(asset(id, "image", photo.time, place, file, photo));
    }

    if (place.video) {
      const id = `v${String(p + 1).padStart(2, "0")}`;
      const dir = join(out, "media", id);
      mkdirSync(dir, { recursive: true });
      const v = place.video;
      let file = null;
      let caption = v.caption;
      if (!offline) {
        const candidates = v.file ? [await pinned(v.file, place)] : files.filter(isVideo).filter((f) => !used.has(f.title));
        for (const f of candidates) {
          try {
            // Reads only the first seconds over HTTP.
            encodeVideo(f.url, ["-user_agent", USER_AGENT, "-ss", "1"], dir);
            file = f;
            used.add(f.title);
            credits.push({ id, title: f.title, url: f.pageUrl, artist: f.artist, license: f.license, licenseUrl: f.licenseUrl });
            console.log(`  ${id} ${f.title} (${f.license}, ${f.artist})`);
            break;
          } catch (err) {
            console.warn(`  Video ${f.title} nicht nutzbar: ${String(err).split("\n")[0]}`);
          }
        }
      }
      if (!file) {
        if (offline) {
          ffmpeg("-f", "lavfi", "-i", "testsrc2=s=1280x720:r=30:d=8", "-f", "lavfi", "-i", "sine=f=440:d=8", "-shortest",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", join(dir, "video.mp4"));
          ffmpeg("-ss", "1", "-i", join(dir, "video.mp4"), "-frames:v", "1", "-q:v", "3", join(dir, "preview.jpg"));
          writeThumbnail(dir);
        } else {
          console.warn(`  Kein freies Video bei ${place.name}: Kameraschwenk über das erste Foto.`);
          panVideo(firstPhotoDir, dir);
          caption = `Kameraschwenk über ${place.name}`;
        }
        file = { lat: place.lat, lng: place.lng };
      }
      const size = JSON.parse(
        execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", join(dir, "video.mp4")]),
      ).streams[0];
      assets.push(asset(id, "video", v.time, place, { ...file, width: size.width, height: size.height }, { ...v, caption }));
    }
  }

  assets.sort((a, b) => a.localDateTime.localeCompare(b.localDateTime));
  const timeline = {
    title: trip.title,
    description: trip.description,
    startDate: assets[0].localDateTime,
    endDate: assets.at(-1).localDateTime,
    captionSource: "description",
    albumComments: trip.albumComments,
    tour: trip.tour,
    assets,
  };
  writeFileSync(join(out, "timeline.json"), JSON.stringify(timeline, null, 2));
  writeFileSync(join(out, "credits.json"), JSON.stringify(credits, null, 2));
  console.log(`${assets.length} Medien geschrieben nach ${out}`);
}

await main();
