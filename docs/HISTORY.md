# Verlauf und Hintergründe

Dieses Dokument hält fest, was in den Claude-Code-Sitzungen gebaut wurde, **warum** und was dabei gelernt wurde. Es ergänzt das [CHANGELOG](../CHANGELOG.md), das nur das Was beschreibt. Für Arbeitsweise und Konventionen siehe [CLAUDE.md](../CLAUDE.md).

## Versionen

### 0.1.0 – Grundgerüst (#1, #2)
- Architektur:
  - Fastify-Backend als Proxy zu Immich. Der API-Key bleibt im Backend, ausgeliefert werden nur Assets freigegebener Alben.
  - SvelteKit-SPA.
  - SQLite für Freigaben.
  - Adminseite hinter Authelia (Header `Remote-User` nur von `trustedProxies`).
- Pro Link einstellbar: Passwort (Cookie mit `passwordVersion`), Ablaufdatum, Titel, Deaktivieren.
- Container-Image über GitHub Actions nach ghcr.io. Quadlet mit Auto-Update.

### 0.2.0 – Galerie, Bildunterschriften, Linkvorschau (#3, #4, #6)
- Bildunterschrift wahlweise aus Beschreibung, erstem Kommentar oder beidem. Optional alle Kommentare.
- PhotoSwipe-Galerie ohne Zoom-Knopf. Beim Schließen steht die Seite beim zuletzt gezeigten Foto.
- Linkvorschau: Die Messenger führen kein JS aus. Deshalb setzt das Backend für `/t/:token` die `og:*`-Tags direkt ins HTML. Bei Passwort-Links nur den Titel.

### 0.3.0 – Tour (#7–#11)
- Vollbild-Tour: Übersicht, Flug zum Ort (Leaflet `flyTo`), Kartenpause mit Ortsname, dann die Medien. Steuerung über Knöpfe, Tastatur und Wischen.
- iPhone: Während des Flugs blieb die Karte grau, weil `updateWhenIdle` auf Mobilgeräten greift. Abhilfe: `updateWhenIdle: false` und eine grobe Hintergrundschicht.
- `/` lieferte 403. Die Static-Wildcard antwortete auf das Wurzelverzeichnis, jetzt gibt es eine eigene Route auf `index.html`.

### 0.4.0 – Projektseite, besserer Überflug (#12–#16)
- GitHub Pages: Werbeseite plus echte Live-Demo (`VITE_DEMO=1`, statische Daten). Freie Commons-Fotos werden pro Ort gesucht, Problemfälle sind fest gepinnt (`site/trip.json`). Die Tour-Videos nimmt Playwright per CDP-Screencast auf.
- Überflug:
  - Punkt und gestrichelte Route bleiben während des Flugs sichtbar. Dafür wird der SVG-Renderer pro Frame zurückgesetzt.
  - Kacheln entlang der ganzen Flugkurve werden vorgeladen. `flightCurve` bildet Leaflets van-Wijk-Kurve nach.
  - Die Flugdauer hängt von der Kurvenlänge ab (1,5–8 s).

### 0.5.0 – Feinschliff Tour, Reiseroute (#17–#20)
- Die Tageskarte erscheint erst, wenn das Foto ausgeblendet ist. Sie verschwindet vor dem nächsten (ein Schleier für alle Zustände, `fade|global`).
- Bei der Ortskarte wird die Karte abgedunkelt.
- „Tour starten“ als große Karte mit Orte, Tage und geschätzter Dauer (Nutzer wählte Variante „A Karte“).
- Reiseroute: Start und Ziel pro Link mit Photon-Ortssuche (öffentliche komoot-Instanz, weltweit), optional als Rundreise. Die Wegpunkte erscheinen in Karte und Tour.
- Bug „Tag 46205“: Das erste Datum kam vom Startwegpunkt ohne Fotos. Jetzt zählt der erste Stopp mit Medien.

### 0.6.0 – Bildschirm an, Fortsetzen (#21–#24)
- Anlass: Auf dem Handy ging der Bildschirm aus, und die Tour begann danach von vorn.
- Lösung:
  - Wake Lock.
  - Beim Sperren pausieren. Ein Fullscreen-Ende bei verborgener Seite heißt Pause, nicht Schließen.
  - Die Position liegt in `localStorage`.
- Nutzerwunsch (#22): „Tour starten“ bleibt unverändert, darunter eine eigene Karte „Tour fortsetzen“ mit ✕. Sie verschwindet nach einem kompletten Durchlauf oder nach 6 h. Mit #24 kam die Restzeit dazu („Ab Ort 4 von 6 · noch ca. 3 Min.“).
- Opera auf Android hielt den Bildschirm trotz Wake Lock nicht an (#23). Abhilfe ist ein unsichtbares, stummes Video in Endlosschleife: Chromium hält den Bildschirm bei sichtbaren, ausreichend großen Videos an.
  - Zuerst lief das Video überall. Auf Nachfrage dann (#24) nur noch bei Opera (`OPR/`) oder fehlender bzw. abgelehnter API, nie in WebKit.
  - Chrome, Edge, Firefox 126+ und Safari 16.4+ haben funktionierende Wake Locks.

### 0.7.0 – Neue Fotos, Changelog (#25, #26)
- Push-Benachrichtigungen wurden verworfen, weil sie auf iOS nur als Homescreen-App funktionieren. Stattdessen gibt es den Hinweis „N neue Fotos · Zum nächsten ↓“. Neue Fotos stehen oft mitten in der Timeline, weil sie nach Aufnahmezeit sortiert ist.
  - Gesehen = mindestens halb im Bild für 0,8 s oder angesprungen.
- Das Changelog wurde nachträglich aus den PRs zusammengestellt. Die Version steht in der Fußzeile.

### 0.8.0 / 0.8.1 – Schnelleres Laden (#27, #28)
- Anlass: Beim Sprung ans Ende kamen die Fotos sehr spät.
- Ursache:
  - Der Smooth-Scroll über die ganze Seite löste `loading=lazy` bei allen Bildern unterwegs aus.
  - `srcset` wählte auf dem Handy immer das 1440-px-Preview.
- Lösung:
  - `progressive.ts`: Erst das Thumbnail (unscharf), das Preview erst nach 150 ms in der Nähe des Bildschirms.
  - Weite Sprünge laufen erst instant bis kurz vor das Ziel, dann weich. Das Ziel-Preview wird sofort vorgeladen.
- Aus Issue #5:
  - Videos mit `preload=none`.
  - `@fastify/compress`.
  - AlbumCache mit stale-while-revalidate (bis 1 h, Retry nach 30 s).
  - nginx-`proxy_cache`-Beispiel: 10 min, `private` wird nie gespeichert. Nicht mit `nginx -t` geprüft, weil in der Sitzung kein Docker lief.
  - `chunkedLoading`.
- 0.8.1: Der grüne Rahmen beim Hinspringen wurde auf Wunsch entfernt.

### 0.9.0 / 0.9.1 – GeoPulse (#29, #30)
- Der Nutzer hat GeoPulse (selbst gehostete Standort-Timeline) auf demselben Server.
- Umgesetzt wurde die „echte Route“, Nutzerauswahl unter vier Ideen:
  - Das Backend holt GPS-Spur und Fahrten für den Zeitraum zwischen erstem und letztem Foto.
  - Es behält nur Punkte während Fahrten, einen Abschnitt pro Fahrt mit Verkehrsmittel.
  - Es schneidet die Spur um Start und Ziel der Reise ab (`privacyRadiusMeters`) und vereinfacht sie.
  - Die Karte färbt nach Verkehrsmittel und zeigt eine Legende. In der Tour folgt der Punkt der Strecke (nächster Pfadpunkt zur Kartenmitte, nur vorwärts).
- **Fehler in 0.9.0:** Die Pfade stammten aus GeoPulse `main`, also dem unveröffentlichten v2 (`/api/v1/...`, `from`/`to`). Der Server lieferte 404.
  - 0.9.1 unterstützt zusätzlich das veröffentlichte 1.x: `/api/streaming-timeline`, `/api/gps/path`, `startTime`/`endTime`, Antwort `{status,data}`. Bei 404 wird automatisch gewechselt.
  - Gegen die OpenAPI-Spezifikation von v1.39.0 (`docs/openapi/openapi.json` im Tag) geprüft. Die Spec nennt nur JWT, laut Code akzeptiert 1.39 API-Tokens per `X-API-Key`.
  - **Lehre: bei Fremdprojekten gegen den Release-Tag prüfen, nicht gegen `main`.**
- Nur gegen einen Mock getestet, nicht gegen eine echte GeoPulse-Instanz.
- Nachfrage zu Wegen ohne Fotos: Die Karte zeigt alle erkannten Fahrten, auch Wanderungen. Die Tour zeigt nur Wege zwischen Orten. Der Nutzer will es so lassen.

### 0.10.0 – Einzelne Fotos teilen (#31)
- Ein Teilen-Symbol unter jedem Foto und in der Galerie. Auf dem Handy öffnet `navigator.share`, sonst wird kopiert und der Toast „Link kopiert“ erscheint.
- `?foto=<id>` springt beim Öffnen zum Foto. Die Linkvorschau zeigt dieses Foto, außer bei Passwort-Links.

### 0.11.0 – Tour nur über neue Fotos (#33)
- Wunsch: neue Ergänzungen einer laufenden Reise als kurze Tour ansehen. Eigene Karte „Neue Fotos als Tour“ unter „Tour starten“ (nur wenn neue Fotos mit GPS existieren); Tour mit `{...timeline, assets: neu, trip: undefined}`, `dayOrigin` für die richtige Tageszahl, `onshow` markiert gezeigte Fotos als gesehen (Nutzerentscheidung); keine Fortsetzen-Position.

### 0.12.0 – Akzentfarbe pro Link (#34)
- Der Nutzer fragte, warum Grün. Ich hatte es selbst gewählt (ruhig, „Natur/Reise“). Fünf Varianten wurden als Screenshots verglichen (hell, dunkel, Tour), dann der Wunsch: im Admin wählbar aus einer kuratierten Liste.
- Spalte `accent` (Migration 6, Standard `gruen`), zod-Enum in der Admin-API, Feld `accent` im Timeline-JSON. Das Frontend setzt per `applyAccent` ein `<style id="mt-accent">` mit hell/dunkel-Variante, **bevor** die Timeline rendert, denn die Karte liest `--accent` nur beim Aufbau (`accentColor`).
- Verläufe der Tour-Karten mischen jetzt mit `black` statt einem grünlichen Dunkel, damit andere Farben keinen Grünstich bekommen.
- Die Verkehrsmittel-Farben der GeoPulse-Legende bleiben fest; Ozeanblau ähnelt dem Auto-Blau, ist aber dunkler.

### 0.13.0 – Tour ab Foto (#35)
- Wunsch: Klick auf ein Foto startet die Tour dort statt der Galerie, im Admin pro Link schaltbar (Spalte `photo_click_tour`, Migration 7; im Timeline-JSON `tour.fromPhoto`).
- Nutzerentscheidungen: Einstieg **direkt beim Foto** (Tour-Prop `direct`: Karte sofort per `setView` am Ort, `goTo(..., { arrive: false })`, keine Übersicht, kein Flug, keine Orts-/Tageskarte), danach normal weiter bis zum Ende; Abbrechen speichert „Fortsetzen“ wie gewohnt. Die Galerie bleibt über einen ⛶-Knopf am Foto erreichbar (wie bei Videos). Videos bleiben unverändert (Klick spielt ab).
- `findInStops` (tour.ts) sucht Ort und Position des Fotos; Fotos ohne GPS hängen am vorigen Ort und starten dort.

### 0.13.1 – Tour ab Foto: Position beim Verlassen (#36)
- Wunsch: Nach einer per Foto gestarteten Tour soll die Seite beim zuletzt gezeigten Foto stehen, nach komplettem Durchlauf oben. `onshow` merkt `lastShown`, `onprogress(null)` bei offener Tour heißt „durchgelaufen“ (das ✕ der Fortsetzen-Karte ruft es ohne offene Tour). Andere Touren kehren weiter zur Startposition zurück.

### 0.14.0 – Highlights als Tour (#37)
- Wunsch: eine kürzere Tour nur mit den besten Fotos, Knopf erst ab einer Mindestzahl Likes.
- Nutzerentscheidungen: Highlight = Like im geteilten Album (Immich-Aktivität `type: like`) **oder** Favorit des Besitzers (`isFavorite` aus `search/metadata`). Mindestzahl = Anzahl solcher Fotos, pro Link (`highlight_min_likes`, Migration 8, Standard 5, 0 = aus).
- Aktivitäten werden jetzt ohne `type`-Filter geholt (ein Aufruf für Kommentare und Likes), `TimelineAsset.liked` im Backend. Die Tour nutzt denselben Teil-Tour-Weg wie „Neue Fotos als Tour“ (`newTour`), aber mit Start und Ziel der Reise; gezeigte Fotos gelten als gesehen.

### Dependabot (kein Release, PR #38)
- `.github/dependabot.yml`: wöchentlich npm (backend, frontend), GitHub Actions und das Basis-Image. Minor/Patch je Ökosystem gebündelt.
- `deploy/Containerfile` heißt jetzt `deploy/Dockerfile`, weil Dependabot nur nach diesem Namen sucht. Podman baut sie unverändert (`podman build -f deploy/Dockerfile`).

### Dependabot: Major-Updates ignoriert (kein Release)
- Der erste Lauf öffnete neun PRs. Grün waren nur die Pages-Aktionen (#42–#44) und das Image mit Node 26 (#39, aber die CI startet das Image nicht und testet auf Node 22). Rot: TypeScript 7 (Lock-Datei von backend und frontend getrennt aktualisiert, `npm ci` bricht ab), `@types/node` 26, `cookie` 2, `adapter-static` 4 (braucht SvelteKit 3, nur als Vorabversion).
- Entscheidung: große Sprünge dieser Pakete (und der Node-Version im Image) per `ignore` stummschalten, kleine Updates laufen weiter. Ein Node-Wechsel braucht einen Start des Containers (`node:sqlite`, argon2) und ein gleichzeitiges Anheben von `@types/node`.
- Nachtrag: Die ersten npm-PRs änderten nur die `package.json` des Workspace-Pakets, nicht die Lock-Datei im Wurzelordner, und scheiterten an `npm ci`. Der npm-Eintrag beobachtet jetzt den Wurzelordner (`directory: /`). Zusätzlich wird der Major von `@sveltejs/kit` ignoriert, weil SvelteKit 3 und `adapter-static` 4 zusammen von Hand gewechselt werden.

## Test-Setup in der Cloud-Sitzung

Die E2E-Skripte und Mocks lagen im Scratchpad der Sitzung, nicht im Repo. So lassen sie sich neu bauen:

- **Immich-Mock** (Node `http`, Port 9999, API-Key `dev`):
  - Ein Album „Norwegen 2026“ mit 7 Assets: p1, p1b in Bergen, v1 als Video (WebM), nx ohne GPS, p2, p3 Geiranger, p4 Oslo.
  - Thumbnails sind farbige SVGs mit Asset-ID und Größe im Bild.
  - Endpunkte: `/api/albums`, `/api/albums/:id`, `/api/search/metadata`, `/api/activities`, `/api/assets/:id/thumbnail`, `/api/assets/:id/video/playback` (mit Range).
  - Für Lasttests eine Variante mit 60 zusätzlichen Füllfotos.
- **Photon-Mock** (Port 9997) für die Ortssuche.
- **GeoPulse-Mock** (Port 9996, Token `gp-test`): Format wie 1.x. Er liefert eine gewundene Spur zwischen den Fotoorten mit Fahrten CAR/BOAT/CAR/TRAIN plus Aufenthalts-Jitter, der nicht erscheinen darf.
- **Backend starten:** `MEDIATIMELINE_CONFIG=…/config.yaml MEDIATIMELINE_DATA_DIR=…/data MEDIATIMELINE_STATIC_DIR=frontend/build node --disable-warning=ExperimentalWarning backend/dist/index.js`. Admin-Aufrufe lokal mit Header `Remote-User`, `trustedProxies: ["loopback"]`.
- **Playwright:**
  - Chromium vorinstalliert unter `/opt/pw-browsers`. Start mit `--no-proxy-server`, sonst läuft localhost über den Proxy.
  - OSM-Kacheln per `context.route` mit einer lokalen PNG beantworten.
  - Geräte: `devices["Pixel 7"]`, `devices["iPhone 15"]`, hell und dunkel.
  - Das Test-Chromium kann **kein H.264**, deshalb hat `keepAwake.ts` zusätzlich eine VP8-Quelle.
  - Browser-Fähigkeiten per `addInitScript` simulieren (Wake Lock, `navigator.share`, User-Agent für Opera/Firefox). Zwischenablage über `grantPermissions`.
- Prozesse beenden nur mit verankerten Mustern, z. B. `pgrep -f "^node --disable-warning=ExperimentalWarning /home/user/mediatimeline/backend"`. Ein `pkill -f` mit zu breitem Muster beendet die eigene Shell.

## Offene Punkte und Ideen

- Issue #5: Tage stückweise nachladen bzw. `content-visibility`, erst bei tausenden Medien und nur, wenn die Sprungziele genau bleiben.
- Kurze, verständliche Fehlermeldung bei kaputter `config.yaml` statt YAML-Stacktrace (angeboten, noch nicht beauftragt).
- Adminseite: Hinweis, wenn GeoPulse für den Zeitraum eines Links keine Daten hat.
- Weitere GeoPulse-Ideen: Fotos ohne GPS über die Aufnahmezeit verorten, Reisestatistik (km je Verkehrsmittel), Ortsnamen aus GeoPulse.
- Adminseite auf dem Handy: Der Punkt vor dem gewählten Start/Ziel-Ort (PlaceInput) steht in einer eigenen Zeile.
- Opera auf echtem Android-Gerät mit dem Video-Fallback: vom Nutzer noch nicht bestätigt.
