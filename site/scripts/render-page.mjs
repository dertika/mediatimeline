#!/usr/bin/env node
// Writes the project page (site/index.html + style.css) into the built site,
// with the absolute site URL for link previews and the photo credits.
//
//   render-page.mjs <site dir>      env: SITE_URL (no trailing slash)

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const site = process.argv[2];
if (!site) throw new Error("usage: render-page.mjs <site dir>");
const siteUrl = (process.env.SITE_URL ?? "https://dertika.github.io/mediatimeline").replace(/\/$/, "");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const creditsFile = join(site, "demo-data", "credits.json");
const credits = existsSync(creditsFile) ? JSON.parse(readFileSync(creditsFile, "utf8")) : [];
const list = credits.length
  ? `<ul>\n${credits
      .map((c) => {
        const name = c.title.replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "");
        const license = c.licenseUrl ? `<a href="${esc(c.licenseUrl)}">${esc(c.license)}</a>` : esc(c.license);
        return `          <li><a href="${esc(c.url)}">${esc(name)}</a> – ${esc(c.artist)}, ${license}</li>`;
      })
      .join("\n")}\n        </ul>`
  : "<p>Dieser Build verwendet Platzhalterbilder.</p>";

const html = readFileSync(join(here, "..", "index.html"), "utf8")
  .replaceAll("%SITE_URL%", siteUrl)
  .replace("<!-- CREDITS -->", list);
writeFileSync(join(site, "index.html"), html);
copyFileSync(join(here, "..", "style.css"), join(site, "style.css"));
