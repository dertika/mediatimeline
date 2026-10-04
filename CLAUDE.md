# CLAUDE.md – Arbeitsnotizen für Claude Code

mediatimeline macht aus Immich-Alben öffentliche Foto-Timelines: Karte, Fotos/Videos nach Tagen, Vollbild-Galerie und eine animierte Tour von Ort zu Ort. Backend: Fastify (TypeScript, `node:sqlite`). Frontend: SvelteKit 5, statisch gebaut (adapter-static), wird vom Backend ausgeliefert. Betrieb als Podman-Container, die Adminseite liegt hinter Authelia (nginx `auth_request`). Optional zeigt eine GeoPulse-Anbindung die echte gefahrene Route.

Der ausführliche Verlauf mit allen Versionen, Gründen, Stolperfallen und dem Test-Setup steht in **[docs/HISTORY.md](docs/HISTORY.md)**. Lies ihn, bevor du größere Änderungen machst.

## Aufbau (das Wichtigste)

```
backend/src/
  app.ts               Fastify-App, Plugins (cookie, rate-limit, compress, static)
  config.ts            YAML + ENV (zod); optional: geocoder, geopulse
  immich/client.ts     Immich-API; immich/cache.ts AlbumCache (TTL + stale-while-revalidate)
  geopulse.ts          GeoPulse-Client (API 1.x und v2), buildRoute (Fahrten, Datenschutzradius, Douglas-Peucker)
  geocoder.ts          Photon-Ortssuche für die Adminseite
  routes/public.ts     /api/public/timeline/:token (+ Medien-Proxy, Passwort, route)
  routes/preview.ts    Linkvorschau (og:*) für /t/:token, auch ?foto=<id>
  routes/admin.ts      Admin-API, /api/admin/me meldet {geopulse}
  store/db.ts          Freigaben in SQLite, Migrationen über PRAGMA user_version (MIGRATIONS-Array, nur anhängen)
frontend/src/lib/
  TimelineView.svelte  Timeline-Seite: Tour-Karten, Karte, Tage/Fotos, Hinweis auf neue Fotos, Teilen, Deep-Link
  Tour.svelte          Vollbild-Tour (Leaflet flyTo, Tages-/Ortskarten, Pause, Wake Lock, Fortsetzen)
  TimelineMap.svelte   Übersichtskarte (Cluster, Start/Ziel, GeoPulse-Route mit Legende)
  tour.ts / route.ts   Stops, Flugkurve (van Wijk), Dauer-Schätzung / Routen-Legs für die Tour
  progressive.ts       erst Thumbnail, dann Preview (Verweilzeit 150 ms)
  keepAwake.ts         Wake Lock + Video-Fallback (nur Opera / ohne API, nie WebKit)
  seenMedia.ts         gesehene Asset-IDs pro Link (localStorage) für „neue Fotos“
  share.ts             Foto-Links ?foto=<id>, navigator.share / Zwischenablage, Toast
  tourProgress.ts      Tour-Position zum Fortsetzen (6 h)
site/                  GitHub-Pages-Projektseite mit Demo (Commons-Fotos) und Tour-Videos
deploy/                Containerfile, Quadlet, Compose, nginx-Beispiel (mit optionalem Bild-Cache)
```

## Befehle

```sh
npm run check   # svelte-check + tsc
npm test        # Vitest Backend + Frontend
npm run build   # Frontend + Backend
```

## Arbeitsweise mit dem Nutzer

- **Sprache:** Antworten auf Deutsch, Code, Kommentare und Commits auf Englisch. Die Oberfläche ist deutsch.
- **Befehle für den Server immer vollständig und direkt kopierbar**, ohne Platzhalter wie `<repo>`. Fehlt eine Angabe, erst nachfragen oder einen Befehl geben, der sie selbst ermittelt.
- **Ablauf pro Änderung:**
  1. Branch neu von `origin/main` erstellen (der vorige PR ist immer schon gemergt).
  2. Umsetzen.
  3. `check`, `test`, `build`.
  4. **E2E im Browser mit Screenshots** (siehe HISTORY → Test-Setup).
  5. Commit, Push, PR, PR-Aktivität abonnieren.
  6. Der Nutzer merged selbst, meist sofort.
- Größere Wünsche erst als Plan mit kurzen Rückfragen (AskUserQuestion), Vorschläge mit Empfehlung.
- Ehrlich bleiben: Was nur gegen Mocks getestet wurde, als solches benennen (z. B. GeoPulse, Opera auf echtem Gerät).

## Versionierung

- Jede Änderung: neuer Eintrag oben in `CHANGELOG.md` (Keep a Changelog, deutsch, mit PR-Link unten). Dazu die gleiche Version in den drei `package.json` (Root, backend, frontend), danach `npm install --package-lock-only`. `frontend/src/lib/version.test.ts` erzwingt den Gleichstand.
- Die Version steht in der Fußzeile (Admin, Timeline, Demo) und kommt per Vite `__APP_VERSION__` aus `frontend/package.json`.
- **Keine Git-Tags pushen:** Der Sitzungs-Proxy erlaubt nur den Arbeitsbranch. Der Nutzer braucht keine Tags, er betreibt `latest` mit `podman auto-update`.

## Bewusste Entscheidungen (nicht ohne Rückfrage ändern)

- Beim Springen zu einem Foto **kein grüner Rahmen** (0.8.1).
- Akzentfarbe pro Link nur aus der **kuratierten Liste** (`backend/src/accent.ts` und `frontend/src/lib/accents.ts`, gleiche IDs, Test prüft Gleichstand und Kontrast), keine freie Farbwahl. Standard Waldgrün, die Adminseite bleibt grün. Neue Farben nur ans Ende anhängen.
- „Tour starten“ beginnt immer von vorn. **Fortsetzen** ist eine eigene Karte darunter, mit Restzeit, gilt 6 h, mit ✕ entfernbar.
- Wach-halten: Wake Lock überall. Das unsichtbare Video **nur** bei Opera (`OPR/`) oder fehlender bzw. abgelehnter API, **nie** in WebKit/iOS.
- Statt Push-Benachrichtigungen: Hinweis-Pille „N neue Fotos · Zum nächsten“. Beim ersten Besuch gilt alles als gesehen.
- Fotos laden progressiv (Thumbnail → Preview). Weite Sprünge erst nah ans Ziel, dann gleiten.
- `content-visibility` / Tage stückweise laden bewusst **nicht**, weil die Sprungziele sonst ungenau werden (Issue #5 bleibt offen).
- GeoPulse: Die Karte zeigt alle Fahrten zwischen erstem und letztem Foto, auch Wanderungen ohne Fotos. Die Tour bleibt bei Wegen zwischen Orten. Gegen **Release-Tags** prüfen (aktuell 1.39, Pfade `/api/streaming-timeline`, `/api/gps/path`), nicht gegen GeoPulse `main` (dort liegt das unveröffentlichte v2).
- Foto-Links nutzen `?foto=<id>` statt `#`, damit die Linkvorschau das Foto zeigt. Bei Passwort-Links wird nie ein Foto verraten.

## Betrieb beim Nutzer (allgemein)

- Podman-Quadlet `mediatimeline.container` mit `AutoUpdate=registry`. Update: `podman auto-update`. Neustart: `systemctl --user restart mediatimeline`. Logs: `journalctl --user -u mediatimeline -f`.
- Images baut GitHub Actions bei jedem Push auf `main` (`latest`, `sha-…`).
- Ein Tippfehler in der `config.yaml` (z. B. ein fehlendes Anführungszeichen) lässt den Dienst beim Start abstürzen, mit einem langen YAML-Stacktrace im Journal.
- GeoPulse läuft auf demselben Server. `geopulse.url` ist die Backend-Basis ohne `/api`, der Token per `X-API-Key`.
