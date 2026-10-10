# mediatimeline für iPhone

Native SwiftUI-App zum Ansehen geteilter Timelines. Sie nutzt dieselbe öffentliche API wie die Webseite (`/api/public/timeline/<token>`), am Backend ist nichts einzustellen.

## Was die App kann

- **Link öffnen:** Link einfügen (Feld oder „Einsetzen“-Knopf), auch mitten aus einer Nachricht. Foto-Links (`?foto=<id>`) springen zum Foto.
- **Zuletzt geöffnet:** Geöffnete Timelines bleiben mit Titel, Zeitraum und Cover in der Liste, löschen mit Wischen nach links.
- **Timeline:** Titel, Zeitraum, Beschreibung, Albumkommentare. Fotos und Videos nach Tagen mit Bildunterschrift, Uhrzeit, Ort und Kommentaren. Erst das kleine Vorschaubild, dann die große Version. Ziehen zum Aktualisieren.
- **Karte (MapKit):** ein Punkt pro Ort mit Foto und Anzahl, Start und Ziel der Reise, die GeoPulse-Route nach Verkehrsmittel mit Legende (sonst eine gestrichelte Linie). Antippen springt zum Ort, ⤢ öffnet die Karte im Vollbild.
- **Galerie:** Vollbild mit Wischen, Pinch- und Doppeltipp-Zoom, Videos mit Player, Teilen-Knopf für den Foto-Link.
- **Passwort-Links:** Passwortabfrage. Das Freischalt-Cookie gilt wie im Browser (`server.unlockTtlHours`).
- **Neue Fotos:** „N neue Fotos · Zum nächsten“ und „Neu“-Badge wie auf der Webseite, gemerkt pro Link auf dem Gerät.
- **Akzentfarbe** des Links, Dunkelmodus automatisch.
- **Demo:** die Beispielreise der Projektseite, ohne eigenen Server.

Die Tour gibt es in der App noch nicht.

## Auf dem eigenen iPhone installieren

Voraussetzungen: Mac mit Xcode 16 oder neuer, iPhone mit iOS 17 oder neuer, eine Apple-ID.

1. Repository holen und das Projekt öffnen:
   ```sh
   git clone https://github.com/dertika/mediatimeline.git
   open mediatimeline/ios/MediaTimeline.xcodeproj
   ```
   Hast du das Repository schon, vorher `git pull` im Ordner `mediatimeline`.
2. In Xcode links das Projekt **MediaTimeline** wählen, dann das Target **MediaTimeline** → **Signing & Capabilities**:
   - **Team:** deine Apple-ID (Xcode → Settings → Accounts → „+“, falls sie fehlt).
   - **Bundle Identifier:** falls Xcode meldet, dass er vergeben ist, einen eigenen eintragen, z. B. `de.<dein-name>.mediatimeline`.
3. iPhone per Kabel anschließen, oben in der Leiste als Ziel auswählen und **▶ Run** (⌘R) drücken.
4. Beim ersten Mal auf dem iPhone: **Einstellungen → Allgemein → VPN und Geräteverwaltung** → deine Apple-ID → **Vertrauen**. Ab iOS 16 außerdem **Einstellungen → Datenschutz & Sicherheit → Entwicklermodus** einschalten (das iPhone startet dafür neu).

Mit einer kostenlosen Apple-ID läuft die App **7 Tage**, danach in Xcode einfach wieder ▶ Run. Mit einem bezahlten Developer-Konto ist es ein Jahr.

Zum Aktualisieren: `git pull`, dann in Xcode ▶ Run.

## Entwicklung

```
ios/
  MediaTimeline.xcodeproj   Xcode-Projekt (Ordner werden automatisch synchronisiert, Xcode 16+)
  MediaTimeline/            SwiftUI-App: Start, Timeline, Karte, Galerie, Bildlader
  MediaTimelineKit/         Swift-Paket ohne UI: Modelle, API, Links, Tage/Orte, „neue Fotos“ (+ Tests)
  MediaTimelineUITests/     UI-Tests mit Screenshots
  e2e/                      Immich-Mock + Backend für die UI-Tests
  Config/Info.plist         Ergänzungen zur generierten Info.plist (http im lokalen Netz)
```

- Unit-Tests: `swift test --package-path ios/MediaTimelineKit`
- UI-Tests gegen das echte Backend mit Immich-Mock:
  ```sh
  npm ci && npm run build -w backend
  ios/e2e/start.sh > /tmp/mt-e2e.env && cat /tmp/mt-e2e.env
  ```
  Dann in Xcode im Schema unter Test → Arguments die Umgebungsvariablen `PUBLIC_LINK` und `PASSWORD_LINK` mit den ausgegebenen Werten setzen und ⌘U drücken. Ohne die Variablen laufen nur die Demo-Tests.
- GitHub Actions (`.github/workflows/ios.yml`) baut die App auf macOS, führt beide Testarten im Simulator aus und lädt die Screenshots als Artefakt `ios-screenshots` hoch.
- Die Version (`MARKETING_VERSION` im Projekt) ist die der Webseite. `frontend/src/lib/version.test.ts` prüft den Gleichstand.
