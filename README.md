# mediatimeline

Öffentliche Foto-Timelines aus [Immich](https://immich.app)-Alben.

Auf einer Adminseite (geschützt durch Authelia) wählst du Immich-Alben aus und erzeugst pro Album einen teilbaren Link. Wer den Link öffnet, sieht:

1. den **Albumnamen** als Überschrift,
2. eine **Karte** mit den Aufnahmeorten (Leaflet/OpenStreetMap, Route in zeitlicher Reihenfolge),
3. alle **Fotos und Videos aufsteigend nach Aufnahmezeit**, nach Tagen gruppiert, mit der Immich-Beschreibung als Bildunterschrift.

Pro Link optional: **Passwortschutz**, **Ablaufdatum**, eigener Titel, deaktivieren/widerrufen.

```
Browser ──> nginx ──(auth_request /admin, /api/admin)──> Authelia
              └──> mediatimeline (Fastify :8080) ──x-api-key──> Immich
```

Der Immich-API-Key verlässt nie das Backend: alle Bilder und Videos werden über mediatimeline ausgeliefert, und zwar nur Assets, die zu einem freigegebenen Album gehören.

## Schnellstart (Podman)

```sh
# 1. Image bauen
podman build -f deploy/Containerfile -t mediatimeline:latest .

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
  localhost/mediatimeline:latest
```

Alternativ: `podman-compose -f deploy/compose.yaml up -d` (erwartet `config.yaml` im Repo-Root).

### Immich-API-Key

In Immich unter *Kontoeinstellungen → API-Schlüssel* einen Key mit den Rechten `album.read`, `asset.read` und `asset.view` anlegen. Statt in `config.yaml` kann der Key auch als Podman-Secret übergeben werden (siehe Kommentare in `deploy/mediatimeline.container`).

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
