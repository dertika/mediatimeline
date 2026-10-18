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
  routes/admin.ts      Admin-API, /api/admin/me meldet {geopulse, via}
  auth/adminGuard.ts   Admin-Zugang: Header von Authelia (Standard) oder OIDC-Sitzung
  auth/oidc.ts         optionaler OpenID-Connect-Login (/api/auth/login, /callback, /logout)
  store/db.ts          Freigaben in SQLite, Migrationen über PRAGMA user_version (MIGRATIONS-Array, nur anhängen)
frontend/src/lib/
  TimelineView.svelte  Timeline-Seite: Tour-Karten, Karte, Tage/Fotos, Hinweis auf neue Fotos, Teilen, Deep-Link
  Tour.svelte          Vollbild-Tour (Leaflet flyTo, Tages-/Ortskarten, Pause, Wake Lock, Fortsetzen); tourPreload.ts lädt die nächsten 2 Medien vor
  TimelineMap.svelte   Übersichtskarte (Cluster, Start/Ziel, GeoPulse-Route mit Legende)
  tour.ts / route.ts   Stops, Flugkurve (van Wijk), Dauer-Schätzung / Routen-Legs für die Tour
  visited.ts           geöffnete Timelines des Geräts für die Startseite (localStorage)
  progressive.ts       erst Thumbnail, dann Preview (Verweilzeit 150 ms)
  keepAwake.ts         Wake Lock + Video-Fallback (nur Opera / ohne API, nie WebKit)
  seenMedia.ts         gesehene Asset-IDs pro Link (localStorage) für „neue Fotos“
  share.ts             Foto-Links ?foto=<id>, navigator.share / Zwischenablage, Toast
  tourProgress.ts      Tour-Position zum Fortsetzen (6 h)
site/                  GitHub-Pages-Projektseite mit Demo (Commons-Fotos) und Tour-Videos
ios/                   iPhone-App (SwiftUI, iOS 17+): MediaTimelineKit (Logik + Tests), App, UI-Tests, e2e/ (Immich-Mock)
deploy/                Dockerfile, Quadlet, Compose, nginx-Beispiel (mit optionalem Bild-Cache)
```

## Befehle

```sh
npm run check   # svelte-check + tsc
npm test        # Vitest Backend + Frontend
npm run build   # Frontend + Backend
# iOS: kein Swift in der Sitzung. Build + Tests nur über .github/workflows/ios.yml (macOS),
# Screenshots landen verkleinert auf dem Branch ci/ios-screenshots (git fetch).
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
- Ehrlich bleiben: Was nur gegen Mocks getestet wurde, als solches benennen (z. B. Opera auf echtem Gerät; GeoPulse und OIDC laufen seit 1.0.0 in echten Umgebungen des Nutzers, die automatischen Tests nutzen Attrappen).

## Versionierung

- Jede Änderung: neuer Eintrag oben in `CHANGELOG.md` (Keep a Changelog, deutsch, mit PR-Link unten). Dazu die gleiche Version in den drei `package.json` (Root, backend, frontend) und als `MARKETING_VERSION` in `ios/MediaTimeline.xcodeproj/project.pbxproj` (4 Stellen), danach `npm install --package-lock-only`. `frontend/src/lib/version.test.ts` erzwingt den Gleichstand.
- **Ab 1.0.0 gilt die Stabilitätszusage der README** (Abschnitt „Stabilität“): Änderungen an `config.yaml`, an den Migrationen oder an den Link-Formaten (`/t/<token>`) müssen abwärtskompatibel sein, sonst gibt es eine neue Hauptversion mit Ankündigung im CHANGELOG. Neue Funktion = Minor, Korrektur = Patch.
- Die iOS-App hat dieselbe Version (`MARKETING_VERSION` in `ios/MediaTimeline.xcodeproj/project.pbxproj`, beide Configs), ebenfalls vom Versionstest geprüft.
- Die Version steht in der Fußzeile (Admin, Timeline, Demo) und kommt per Vite `__APP_VERSION__` aus `frontend/package.json`.
- Dependabot (`.github/dependabot.yml`, wöchentlich: npm, GitHub Actions, Basis-Image in `deploy/Dockerfile`) öffnet PRs für neue Versionen. Die bekommen keinen eigenen Changelog-Eintrag oder Versionssprung; beim nächsten Release kommt ein Sammel-Eintrag. Major-Updates von Node (Image), `@types/node`, TypeScript, `cookie`, `@sveltejs/kit` und `adapter-static` ignoriert Dependabot bewusst: Die macht man von Hand und mit Test (`@types/node` folgt der Node-Version im Dockerfile).
- **Keine Git-Tags pushen:** Der Sitzungs-Proxy erlaubt nur den Arbeitsbranch. Der Nutzer braucht keine Tags, er betreibt `latest` mit `podman auto-update`.

## Bewusste Entscheidungen (nicht ohne Rückfrage ändern)

- Beim Springen zu einem Foto **kein grüner Rahmen** (0.8.1).
- Ortskarte der Tour (Karte mit Kartenpause beim Ortswechsel) ist pro Link abschaltbar, Standard an. Der Ortsname am Foto bleibt immer; Tageskarten sowie Start und Ziel der Reise behalten ihre Karten.
- Startseite zeigt nur Timelines, die dieses Gerät selbst gemerkt hat (`visited.ts`, localStorage, höchstens 30, kein Abgleich zwischen Geräten). Passwort-Links ohne Entsperren nie mit Vorschaubild; Gültigkeit über `/api/public/timeline/:token/status`.
- Akzentfarbe pro Link nur aus der **kuratierten Liste** (`backend/src/accent.ts` und `frontend/src/lib/accents.ts`, gleiche IDs, Test prüft Gleichstand und Kontrast), keine freie Farbwahl. Standard Waldgrün, die Adminseite bleibt grün. Neue Farben nur ans Ende anhängen.
- Adminseite: Der **Authelia-Header bleibt der Standardweg**. OpenID Connect (`admin.oidc`) ist optional, standardmäßig aus und für andere Umgebungen gedacht; Gruppen wie bei Authelia (`allowedGroups`). Läuft in einer echten Umgebung eines Bekannten des Nutzers (Stand 1.0.0); die automatischen Tests nutzen weiter eine Attrappe (`backend/test/mockOidc.ts`).
- Tour ab Foto (Option pro Link): startet direkt beim Foto; beim Verlassen zum zuletzt gezeigten Foto, nach komplettem Durchlauf an den Seitenanfang. Galerie dann über ⛶.
- Highlights als Tour: Like im geteilten Album **oder** Favorit des Besitzers; Karte erst ab Mindestzahl solcher Fotos (pro Link, Standard 5, 0 = aus).
- „Tour starten“ beginnt immer von vorn. **Fortsetzen** ist eine eigene Karte darunter, mit Restzeit, gilt 6 h, mit ✕ entfernbar.
- Wach-halten: Wake Lock überall. Das unsichtbare Video **nur** bei Opera (`OPR/`) oder fehlender bzw. abgelehnter API, **nie** in WebKit/iOS.
- Statt Push-Benachrichtigungen: Hinweis-Pille „N neue Fotos · Zum nächsten“. Beim ersten Besuch gilt alles als gesehen.
- Fotos laden progressiv (Thumbnail → Preview). Weite Sprünge erst nah ans Ziel, dann gleiten.
- `content-visibility` / Tage stückweise laden bewusst **nicht**, weil die Sprungziele sonst ungenau werden (Issue #5 bleibt offen).
- GeoPulse: Die Karte zeigt alle Fahrten zwischen erstem und letztem Foto, auch Wanderungen ohne Fotos. Hin- und Rückreise nur, wenn der Link „Route ab/bis“ (`route_from`/`route_to`) setzt; die Zeiten erweitern den Bereich nur, sonst käme der ganze Weg davor und danach. Die Tour bleibt bei Wegen zwischen Orten. Gegen **Release-Tags** prüfen (aktuell 1.39, Pfade `/api/streaming-timeline`, `/api/gps/path`), nicht gegen GeoPulse `main` (dort liegt das unveröffentlichte v2).
- Foto-Links nutzen `?foto=<id>` statt `#`, damit die Linkvorschau das Foto zeigt. Bei Passwort-Links wird nie ein Foto verraten.

## Betrieb beim Nutzer (allgemein)

- Podman-Quadlet `mediatimeline.container` mit `AutoUpdate=registry`. Update: `podman auto-update`. Neustart: `systemctl --user restart mediatimeline`. Logs: `journalctl --user -u mediatimeline -f`.
- Images baut GitHub Actions bei jedem Push auf `main` (`latest`, `sha-…`).
- Ein Tippfehler in der `config.yaml` (z. B. ein fehlendes Anführungszeichen) lässt den Dienst beim Start abstürzen, mit einem langen YAML-Stacktrace im Journal.
- GeoPulse läuft auf demselben Server. `geopulse.url` ist die Backend-Basis ohne `/api`, der Token per `X-API-Key`.
