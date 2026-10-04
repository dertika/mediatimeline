# mediatimeline

Öffentliche Foto-Timelines aus [Immich](https://immich.app)-Alben.

Auf einer Adminseite (geschützt durch Authelia) wählst du Immich-Alben aus und erzeugst pro Album einen teilbaren Link. Wer den Link öffnet, sieht:

1. den **Albumnamen** als Überschrift,
2. eine **Karte** mit den Aufnahmeorten (Leaflet/OpenStreetMap, Route in zeitlicher Reihenfolge),
3. alle **Fotos und Videos aufsteigend nach Aufnahmezeit**, nach Tagen gruppiert, mit der Immich-Beschreibung als Bildunterschrift.

**Neue Fotos:** Kommen nach einem Besuch Fotos oder Videos dazu, auch mitten in der Timeline, zeigt die Seite beim nächsten Öffnen unten einen Hinweis wie „3 neue Fotos · Zum nächsten ↓“. Jedes Tippen springt zum nächsten neuen Foto, neue Fotos tragen ein „Neu“-Badge. Als gesehen gilt ein Foto, sobald es kurz im Bild war. Der Hinweis lässt sich mit ✕ ausblenden. Gemerkt wird das im Browser (localStorage), beim ersten Besuch gilt alles als gesehen. Gibt es neue Fotos mit Standort, startet „Neue Fotos als Tour“ unter „Tour starten“ eine kurze Tour nur über diese (Tageszählung wie in der ganzen Reise); gezeigte Fotos gelten danach als gesehen.

Fotos erscheinen zuerst als kleines, unscharfes Vorschaubild und werden durch die große Version ersetzt, sobald sie in die Nähe des Bildschirms kommen. Schnelles Scrollen und Sprünge laden so keine großen Bilder auf dem Weg.

**Einzelne Fotos teilen:** Unter jedem Foto (und in der Galerie) erzeugt das Teilen-Symbol einen Link auf genau dieses Foto (`/t/<token>?foto=<id>`) – auf dem Handy über das Teilen-Menü, am Computer wird er kopiert. Wer den Link öffnet, landet direkt bei dem Foto; die Linkvorschau in Messengern zeigt dieses Foto (bei passwortgeschützten Links nicht).

Ein Klick auf ein Bild öffnet eine **Vollbild-Galerie** (PhotoSwipe): Wischen, Pfeiltasten, Pinch-Zoom (ohne Zoom-Knopf); Tag, Ort und Bildunterschrift stehen klein in den Ecken. Die Karte passt sich dem Dark Mode an.

**Tour:** Über „▶ Tour starten“ läuft eine animierte Vollbild-Führung. Sie startet in der Kartenübersicht und fliegt zum ersten Ort. Dort bleibt die Karte kurz mit dem Ortsnamen stehen (so lange wie die Wartezeit pro Foto), dann kommen die Fotos und Videos dieses Orts chronologisch. Beginnt ein neuer Reisetag, erscheint vorher eine Karte „Tag 2“ mit Datum. Fällt der Tageswechsel mit einem neuen Ort zusammen, trägt die Ortskarte das Tag-Badge. Oben links steht immer „Tag · Ort · Foto“. Die Karte lässt sich während der Tour nicht verschieben. Während des Flugs zieht der Punkt die gestrichelte Route hinter sich her. Weite Strecken dauern länger als kurze (1,5–8 s). Die Kartenkacheln entlang der ganzen Flugbahn zum nächsten Ort werden schon vorab geladen. Danach geht es weiter zum nächsten Ort, wobei die Karte nur so weit herauszoomt, wie es die Entfernung erfordert. Bedienung:
- Knöpfe ⏮ ⏸ ⏭ ✕
- Tastatur: Leertaste, ←/→, Esc
- Wischen auf dem Handy

Nach dem letzten Ort zeigt die Karte noch einmal die ganze Route, dann schließt sich die Tour von selbst und die Seite steht wieder dort, wo die Tour gestartet wurde. Videos laufen in der Tour ohne eigene Bedienelemente. Während der Tour bleibt der Bildschirm an: über die Wake-Lock-API (Chrome, Edge, Firefox ab 126, Safari/iOS ab 16.4). Fehlt sie oder lehnt der Browser ab, und immer in Opera (auf Android unzuverlässig), läuft stattdessen ein unsichtbares, stummes Video in Endlosschleife; nicht in Safari/iOS. Wird das Handy trotzdem gesperrt, pausiert die Tour. „Tour starten“ beginnt immer von vorn. Wurde eine Tour abgebrochen, erscheint darunter zusätzlich „Tour fortsetzen“ mit der letzten Station und der ungefähren Restzeit („Ab Ort 4 von 6 · noch ca. 3 Min.“). Der Knopf verschwindet, wenn die Tour durchgelaufen ist, nach 6 Stunden oder über sein ✕. Pro Link einstellbar sind die Wartezeit pro Foto, die maximale Videolänge (0 = ganzes Video) und der Radius, innerhalb dessen Fotos als ein Ort gelten. Videos laufen mit Ton. Blockiert der Browser das, laufen sie stumm weiter und ein „🔊 Ton an“-Knopf erscheint.

Beim Teilen in Messengern (WhatsApp, Signal, Telegram …) zeigt die **Linkvorschau** Albumname, Zeitraum, Anzahl der Medien und das Albumcover. Bei passwortgeschützten Links nur den Namen. Dafür sollte `server.publicBaseUrl` gesetzt sein, weil Messenger absolute Bild-URLs brauchen.

Pro Link optional: **Passwortschutz**, **Ablaufdatum**, eigener Titel, deaktivieren/widerrufen sowie

- **Bildunterschrift**: Immich-Beschreibung · erster Immich-Kommentar · Beschreibung, sonst erster Kommentar · keine
- **Alle Kommentare anzeigen**: Kommentare aus Immich (mit Namen und Datum) unter jedem Bild, Kommentare zum Album unter der Überschrift
- **Akzentfarbe**: Farbe der geteilten Timeline aus einer kuratierten Liste (Waldgrün, Ozeanblau, Fjordtürkis, Terrakotta, Aubergine), jeweils mit eigener Variante für den Dunkelmodus und lesbarer Schrift (WCAG AA). Die Adminseite selbst bleibt grün.
- **Reiseroute**: Start und Ziel der Reise (z. B. Flughafen oder Zuhause), optional als Rundreise mit Ziel = Start. Sie erscheinen auf der Karte und in der Tour als eigene Stationen ohne Fotos. Die Ortssuche mit Autovervollständigung nutzt [Photon](https://photon.komoot.io) (OpenStreetMap, weltweit), einstellbar unter `geocoder.url`.
- **Echte Route aus GeoPulse** (optional): Ist [GeoPulse](https://github.com/tess1o/geopulse) angebunden (`geopulse` in der Konfiguration), zeigen Karte und Tour statt gerader Linien die aufgezeichnete Strecke zwischen erstem und letztem Foto, nach Verkehrsmittel eingefärbt (Auto, Zug, Schiff, Flug, zu Fuß …). In der Tour fährt der Punkt die Strecke ab. Nur Wege unterwegs werden gezeigt, nicht das Hin und Her an einem Ort. Rund um Start und Ziel der Reise wird die Route abgeschnitten (`geopulse.privacyRadiusMeters`, Standard 1 km). Der API-Token bleibt im Backend. Funktioniert mit GeoPulse 1.x (Pfade wie in v1.39) und der kommenden v2; die passende Schnittstelle wird automatisch erkannt.

```
Browser ──> nginx ──(auth_request /admin, /api/admin)──> Authelia
              └──> mediatimeline (Fastify :8080) ──x-api-key──> Immich
```

Der Immich-API-Key verlässt nie das Backend: alle Bilder und Videos werden über mediatimeline ausgeliefert, und zwar nur Assets, die zu einem freigegebenen Album gehören.

## Schnellstart (Podman)

```sh
# 1. Image holen (wird von GitHub Actions gebaut, siehe unten)
podman pull ghcr.io/dertika/mediatimeline:latest
#    oder lokal bauen:
#    podman build -f deploy/Containerfile -t mediatimeline:latest .

# 2. Konfiguration anlegen
mkdir -p ~/.config/mediatimeline
cp config.example.yaml ~/.config/mediatimeline/config.yaml
$EDITOR ~/.config/mediatimeline/config.yaml   # immich.url, immich.apiKey, publicBaseUrl, trustedProxies

# 3a. Als systemd-Dienst (Quadlet)
cp deploy/mediatimeline.container ~/.config/containers/systemd/
systemctl --user daemon-reload
systemctl --user start mediatimeline

# 3b. oder direkt
podman run -d --name mediatimeline -p 127.0.0.1:8080:8080 \
  -v ~/.config/mediatimeline/config.yaml:/config/config.yaml:ro,Z \
  -v mediatimeline-data:/data:U,Z \
  ghcr.io/dertika/mediatimeline:latest
```

Alternativ: `podman-compose -f deploy/compose.yaml up -d` (erwartet `config.yaml` im Repo-Root).

Die Quadlet-Unit setzt `AutoUpdate=registry`; mit `podman auto-update` (oder dem Timer `podman-auto-update.timer`) wird ein neues `latest`-Image automatisch geholt und der Dienst neu gestartet.

### Container-Image (GitHub Actions)

`.github/workflows/container.yml` testet und baut das Image (linux/amd64) und veröffentlicht es in der GitHub Container Registry:

| Ereignis | Image-Tags |
| --- | --- |
| Push auf `main` | `latest`, `sha-<commit>` |
| Git-Tag `v1.2.3` | `1.2.3`, `1.2`, `sha-<commit>` |
| Pull Request | nur Test + Build, kein Push |

Release erstellen: `git tag v0.1.0 && git push origin v0.1.0`.

Neue GHCR-Pakete sind zunächst **privat**. Entweder unter *GitHub → Packages → mediatimeline → Package settings* auf „Public“ stellen oder auf dem Server einloggen: `podman login ghcr.io` (Benutzername + Personal Access Token mit Scope `read:packages`).

### Projektseite (GitHub Pages)

`.github/workflows/pages.yml` baut bei jedem Push auf `main` die Projektseite unter `https://<owner>.github.io/mediatimeline/`:

- Werbeseite aus `site/index.html` und `site/style.css`.
- Live-Demo unter `/demo/`: die echte Timeline-Oberfläche, gebaut mit `VITE_DEMO=1`, mit statischen Daten statt Immich.
- Die Demo-Reise steht in `site/trip.json`. `site/scripts/demo-data.mjs` sucht dazu freie Fotos und ein Video von Wikimedia Commons, die an den jeweiligen Orten aufgenommen wurden. Einzelne Dateien lassen sich dort mit `"file": "File:…"` festlegen.
- Tour-Videos für Desktop und Handy nimmt `site/scripts/record-tour.mjs` mit Playwright auf.

Einmalig nötig: unter *Settings → Pages → Build and deployment* als Quelle „GitHub Actions“ wählen.

Lokal bauen: `site/build.sh` (braucht ffmpeg und Playwright). `DEMO_OFFLINE=1` nimmt Platzhalterbilder statt Commons-Fotos.

### Versionen

Änderungen stehen im [CHANGELOG](CHANGELOG.md). Die Versionsnummer steht in den drei `package.json` (Wurzel, `backend/`, `frontend/`) und erscheint in der Fußzeile der Adminseite und der geteilten Timelines. Ein Test prüft, dass alle drei übereinstimmen und das Changelog mit derselben Version beginnt.

Neue Version veröffentlichen: Version in den `package.json` und im Changelog erhöhen, `npm install --package-lock-only` ausführen, nach dem Merge `git tag v0.7.0 && git push origin v0.7.0` (baut die Image-Tags `0.7.0` und `0.7`).

### Immich-API-Key

In Immich unter *Kontoeinstellungen → API-Schlüssel* einen Key mit den Rechten `album.read`, `asset.read` und `asset.view` anlegen. Für Kommentare zusätzlich `activity.read` – fehlt es, funktioniert die Timeline weiterhin, nur ohne Kommentare (Warnung im Log). Statt in `config.yaml` kann der Key auch als Podman-Secret übergeben werden (siehe Kommentare in `deploy/mediatimeline.container`).

## Authelia & nginx

`deploy/nginx/mediatimeline.conf` (plus Snippet `mediatimeline-proxy.conf`) enthält eine vollständige Beispielkonfiguration:

- `/admin` und `/api/admin/` laufen über `auth_request` gegen Authelia (`/api/authz/auth-request`); nginx reicht `Remote-User`/`Remote-Groups` an mediatimeline weiter.
- Für alle anderen Pfade werden diese Header geleert, damit niemand sie fälschen kann.
- Die Authelia-Regeln stehen als Kommentar am Ende der Datei (`/admin*` → `two_factor`, Rest → `bypass`).
- Optional: ein Cache für Vorschaubilder (`proxy_cache_path` oben in der Datei, Verzeichnis `/var/cache/nginx/mediatimeline` anlegen). Er hält Thumbnails und Previews öffentlicher Links 10 Minuten und entlastet Immich, wenn viele Leute dieselbe Reise ansehen. Passwortgeschützte Links werden nie gecacht. Wird ein Link widerrufen oder bekommt er ein Passwort, sind bereits gecachte Bilder noch bis zu 10 Minuten abrufbar. Wer das nicht möchte, lässt den Block weg. Ob es greift, zeigt der Header `X-Cache-Status`.

Zusätzlich akzeptiert das Backend `Remote-User` nur von Adressen in `server.trustedProxies`. Welche Adresse der Container für nginx sieht, hängt vom Podman-Netzwerk ab (rootless mit pasta/slirp4netns oft `10.0.2.2` bzw. die Host-IP). Bei einem 401 auf der Adminseite steht die tatsächliche Adresse im Log (`podman logs mediatimeline`, Feld `remoteAddress`) und gehört dann in `trustedProxies`. Mit `admin.allowedGroups` lässt sich der Zugriff auf Authelia-Gruppen einschränken.

## Endpunkte

| Pfad | Zweck |
| --- | --- |
| `/admin` | Adminseite (Authelia) |
| `/t/<token>` | öffentliche Timeline |
| `/api/admin/*` | Admin-API (Alben, Freigaben, Cache leeren) |
| `/api/public/timeline/<token>` | Timeline-Daten; `/unlock` für Passwort; `/assets/<id>/{thumbnail,preview,video}` Medien-Proxy |
| `/healthz`, `/readyz` | Liveness bzw. Immich-Erreichbarkeit |

Statuscodes der öffentlichen API: `404` = unbekannt/deaktiviert, `410` = abgelaufen, `401` = Passwort nötig, `429` = zu viele Passwortversuche (10 pro 15 min).

## Entwicklung

Voraussetzung: Node.js ≥ 22.13 (nutzt das eingebaute `node:sqlite`).

```sh
npm install
cp config.example.yaml config.yaml          # anpassen
MEDIATIMELINE_CONFIG=config.yaml MEDIATIMELINE_DATA_DIR=./data npm run dev:backend
npm run dev:frontend                        # Vite auf :5173, /api wird an :8080 weitergeleitet
```

Lokal ohne nginx die Adminseite nutzen: `trustedProxies: ["loopback"]` und den Header z. B. per Browser-Extension oder `curl -H 'Remote-User: ich'` setzen.

```sh
npm test        # Backend-Tests (Vitest, inkl. Immich-Mock)
npm run check   # TypeScript + svelte-check
npm run build   # Frontend + Backend bauen
```

### Aufbau

```
backend/   Fastify-Server (TypeScript)
  src/config.ts           YAML-Konfiguration + ENV-Overrides (zod)
  src/immich/             Immich-API-Client, Album-Cache
  src/store/db.ts         SQLite (Freigaben)
  src/auth/               Admin-Guard (Remote-User), Passwort/Cookie
  src/routes/             Admin-API, öffentliche API, Medien-Proxy
frontend/  SvelteKit (statisch, SPA)
  src/routes/admin/       Adminseite
  src/routes/t/[token]/   öffentliche Timeline
deploy/    Containerfile, Quadlet, Compose, nginx
```

Daten liegen in `/data/mediatimeline.db` (SQLite) und `/data/session-secret`.
