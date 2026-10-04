# Changelog

Alle nennenswerten Änderungen an mediatimeline. Das Format folgt [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), die Versionsnummern [Semantic Versioning](https://semver.org/lang/de/). Die Versionen bis 0.6.0 wurden nachträglich aus den Pull Requests zusammengestellt.

## [0.11.0] – 2026-10-04

### Neu
- „Neue Fotos als Tour“: Gibt es seit dem letzten Besuch neue Fotos mit Standort, fährt eine eigene Karte unter „Tour starten“ die Tour nur über diese ab – ohne Start und Ziel der Reise, mit der Tageszählung der ganzen Reise. In der Tour gezeigte Fotos gelten als gesehen; die normale „Tour fortsetzen“-Position bleibt unberührt.

## [0.10.0] – 2026-10-04

### Neu
- Einzelne Fotos teilen: Ein Teilen-Symbol unter jedem Foto und in der Vollbild-Galerie erzeugt einen Link auf genau dieses Foto (Teilen-Menü auf dem Handy, sonst in die Zwischenablage). Der Link öffnet die Timeline direkt bei dem Foto, die Linkvorschau in Messengern zeigt das Foto mit Bildunterschrift, Datum und Ort.

## [0.9.1] – 2026-10-04

### Behoben
- GeoPulse: Die Route blieb mit der veröffentlichten GeoPulse-Version 1.x leer (404), weil nur die Pfade der kommenden v2 abgefragt wurden. Jetzt werden beide Schnittstellen unterstützt und automatisch erkannt. Hat GeoPulse für den Zeitraum keine Daten, steht das im Log.

## [0.9.0] – 2026-10-03

### Neu
- Echte Route aus GeoPulse: Mit einem GeoPulse-API-Token in der Konfiguration lässt sich pro Link einschalten, dass Karte und Tour die aufgezeichnete Strecke zwischen erstem und letztem Foto zeigen, eingefärbt nach Verkehrsmittel, mit Legende. In der Tour folgt der Punkt beim Überflug der Strecke. Rund um Start und Ziel der Reise wird die Route abgeschnitten.

## [0.8.1] – 2026-10-03

### Geändert
- Beim Springen zu einem Foto (neue Fotos, Kartenpunkte, Galerie schließen) erscheint kein grüner Rahmen mehr.

## [0.8.0] – 2026-10-03

### Geändert
- Fotos laden zuerst als kleines, unscharfes Vorschaubild aus Immich und werden durch die große Version ersetzt, sobald sie in die Nähe des Bildschirms kommen. Schnelles Scrollen lädt keine großen Bilder mehr auf dem Weg.
- Sprünge über weite Strecken („Zum nächsten“ bei neuen Fotos, Kartenpunkte) springen erst nah ans Ziel und gleiten dann das letzte Stück, das Zielbild wird sofort geladen. Vorher kamen die Fotos am Ende sehr spät.

### Performance (#5)
- Videos laden erst beim Abspielen (`preload="none"`), das Poster ebenfalls zuerst als Thumbnail.
- JSON-Antworten werden komprimiert (Brotli/gzip).
- Album-Cache mit Stale-while-revalidate: Nach Ablauf wird der alte Stand sofort ausgeliefert und im Hintergrund aus Immich neu geladen.
- nginx-Beispiel mit optionalem Cache für Vorschaubilder öffentlicher Links.
- Karte: Marker werden in Etappen hinzugefügt (`chunkedLoading`).

## [0.7.0] – 2026-10-03

### Neu
- Hinweis auf neue Fotos: Kommen nach einem Besuch Fotos oder Videos dazu, auch mitten in der Timeline, zeigt die Seite unten „3 neue Fotos · Zum nächsten ↓“. Jedes Tippen springt zum nächsten neuen Foto, neue Fotos tragen ein „Neu“-Badge (#25).
- Versionsnummer in der Fußzeile der Adminseite und der geteilten Timelines, verlinkt auf dieses Changelog.

## [0.6.0] – 2026-10-03

### Neu
- Tour: Der Bildschirm bleibt während der Tour an (Wake Lock). Wird das Handy gesperrt, pausiert die Tour (#21).
- Tour fortsetzen: Nach einem Abbruch erscheint unter „Tour starten“ eine eigene Karte „Tour fortsetzen“ mit der letzten Station und der Restzeit. Sie verschwindet nach einem kompletten Durchlauf, nach 6 Stunden oder über ✕ (#21, #22, #24).

### Behoben
- Opera auf Android schaltete den Bildschirm trotz Wake Lock ab. Dort und in Browsern ohne Wake Lock hält ihn jetzt ein unsichtbares, stummes Video an, in Safari/iOS nicht nötig (#23, #24).

## [0.5.0] – 2026-10-03

### Neu
- Reiseroute: Start und Ziel der Reise pro Link, mit Ortssuche (Photon) in der Adminseite, optional als Rundreise. Sie erscheinen auf der Karte und in der Tour als eigene Stationen (#20).
- Tour starten als große Karte über die ganze Breite, mit Anzahl der Orte, Tage und geschätzter Dauer (#19).

### Geändert
- Tour: Die Tageskarte erscheint erst, wenn das Foto ausgeblendet ist, und verschwindet vor dem nächsten (#17).
- Tour: Hinter der Ortskarte wird die Karte abgedunkelt, keine Überblendungen mehr mit Fotos (#18).

## [0.4.0] – 2026-10-03

### Neu
- Projektseite auf GitHub Pages mit Live-Demo, freien Demo-Fotos von Wikimedia Commons und aufgenommenen Tour-Videos (#12, #13, #14, #16).

### Geändert
- Tour: Punkt und Route bleiben während des Flugs sichtbar, Kartenkacheln entlang der ganzen Flugbahn werden vorgeladen, die Flugdauer hängt von der Entfernung ab (#15).

## [0.3.0] – 2026-10-02

### Neu
- Animierte Vollbild-Tour durch alle Orte eines Albums: Kartenpause mit Ortsname, dann die Fotos und Videos des Orts, Tageswechsel, Steuerung per Knopf, Tastatur und Wischen (#7, #8, #9, #10).

### Behoben
- Die Startseite „/“ lieferte 403 Forbidden (#11).
- Graue Karte während des Flugs auf dem iPhone (#9).

## [0.2.0] – 2026-10-02

### Neu
- Immich-Beschreibungen und -Kommentare als Bildunterschriften, auf Wunsch alle Kommentare (#3).
- Vollbild-Galerie mit Wischen und Pinch-Zoom, Karte im Dark Mode (#3).
- Nach dem Schließen der Galerie steht die Seite beim zuletzt angesehenen Foto (#4).
- Linkvorschau mit Albumname, Zeitraum und Cover für Messenger (#6).

## [0.1.0] – 2026-10-01

### Neu
- Öffentliche Foto-Timelines aus Immich-Alben: Adminseite hinter Authelia, teilbare Links mit optionalem Passwort und Ablaufdatum, Karte der Aufnahmeorte, Fotos und Videos nach Tagen (#1).
- Container-Image auf der GitHub Container Registry, gebaut von GitHub Actions (#2).

[0.11.0]: https://github.com/dertika/mediatimeline/pull/33
[0.10.0]: https://github.com/dertika/mediatimeline/pull/31
[0.9.1]: https://github.com/dertika/mediatimeline/pull/30
[0.9.0]: https://github.com/dertika/mediatimeline/pull/29
[0.8.1]: https://github.com/dertika/mediatimeline/pull/28
[0.8.0]: https://github.com/dertika/mediatimeline/pull/27
[0.7.0]: https://github.com/dertika/mediatimeline/pull/26
[0.6.0]: https://github.com/dertika/mediatimeline/pull/24
[0.5.0]: https://github.com/dertika/mediatimeline/pull/20
[0.4.0]: https://github.com/dertika/mediatimeline/pull/16
[0.3.0]: https://github.com/dertika/mediatimeline/pull/11
[0.2.0]: https://github.com/dertika/mediatimeline/pull/6
[0.1.0]: https://github.com/dertika/mediatimeline/pull/2
