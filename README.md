# mediatimeline

Öffentliche Foto-Timelines aus [Immich](https://immich.app)-Alben.

Auf einer Adminseite (geschützt durch Authelia) wählst du Immich-Alben aus und erzeugst pro Album einen teilbaren Link. Wer den Link öffnet, sieht:

1. den **Albumnamen** als Überschrift,
2. eine **Karte** mit den Aufnahmeorten (Leaflet/OpenStreetMap, Route in zeitlicher Reihenfolge),
3. alle **Fotos und Videos aufsteigend nach Aufnahmezeit**, nach Tagen gruppiert, mit der Immich-Beschreibung als Bildunterschrift.

Ein Klick auf ein Bild öffnet eine **Vollbild-Galerie** (PhotoSwipe): Wischen, Pfeiltasten, Pinch-Zoom; Tag, Ort und Bildunterschrift stehen klein in den Ecken. Die Karte passt sich dem Dark Mode an.

**Tour:** Über „▶ Tour starten“ läuft eine animierte Vollbild-Führung. Sie startet in der Kartenübersicht, fliegt zum ersten Ort und zeigt dort die Fotos und Videos chronologisch. Danach geht es weiter zum nächsten Ort, wobei die Karte nur so weit herauszoomt, wie es die Entfernung erfordert. Bedienung:
- Knöpfe ⏮ ⏸ ⏭ ✕
- Tastatur: Leertaste, ←/→, Esc
- Wischen auf dem Handy

Beim Schließen springt die Timeline zum zuletzt gezeigten Foto. Pro Link einstellbar sind die Wartezeit pro Foto, die maximale Videolänge (0 = ganzes Video) und der Radius, innerhalb dessen Fotos als ein Ort gelten. Videos laufen mit Ton. Blockiert der Browser das, laufen sie stumm weiter und ein „🔊 Ton an“-Knopf erscheint.

Beim Teilen in Messengern (WhatsApp, Signal, Telegram …) zeigt die **Linkvorschau** Albumname, Zeitraum, Anzahl der Medien und das Albumcover. Bei passwortgeschützten Links nur den Namen. Dafür sollte `server.publicBaseUrl` gesetzt sein, weil Messenger absolute Bild-URLs brauchen.

Pro Link optional: **Passwortschutz**, **Ablaufdatum**, eigener Titel, deaktivieren/widerrufen sowie

- **Bildunterschrift**: Immich-Beschreibung · erster Immich-Kommentar · Beschreibung, sonst erster Kommentar · keine
- **Alle Kommentare anzeigen**: Kommentare aus Immich (mit Namen und Datum) unter jedem Bild, Kommentare zum Album unter der Überschrift

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

### Immich-API-Key

In Immich unter *Kontoeinstellungen → API-Schlüssel* einen Key mit den Rechten `album.read`, `asset.read` und `asset.view` anlegen. Für Kommentare zusätzlich `activity.read` – fehlt es, funktioniert die Timeline weiterhin, nur ohne Kommentare (Warnung im Log). Statt in `config.yaml` kann der Key auch als Podman-Secret übergeben werden (siehe Kommentare in `deploy/mediatimeline.container`).

## Authelia & nginx

`deploy/nginx/mediatimeline.conf` (plus Snippet `mediatimeline-proxy.conf`) enthält eine vollständige Beispielkonfiguration:

- `/admin` und `/api/admin/` laufen über `auth_request` gegen Authelia (`/api/authz/auth-request`); nginx reicht `Remote-User`/`Remote-Groups` an mediatimeline weiter.
- Für alle anderen Pfade werden diese Header geleert, damit niemand sie fälschen kann.
- Die Authelia-Regeln stehen als Kommentar am Ende der Datei (`/admin*` → `two_factor`, Rest → `bypass`).

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
