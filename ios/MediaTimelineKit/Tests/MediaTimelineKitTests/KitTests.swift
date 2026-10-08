import XCTest
@testable import MediaTimelineKit

private func fixture(_ name: String = "timeline") throws -> Timeline {
    let url = try XCTUnwrap(Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"))
    return try JSONDecoder().decode(Timeline.self, from: Data(contentsOf: url))
}

final class ModelTests: XCTestCase {
    func testDecodesServerTimeline() throws {
        let timeline = try fixture()
        XCTAssertEqual(timeline.title, "Norwegen 2026")
        XCTAssertEqual(timeline.assets.count, 6)
        XCTAssertEqual(timeline.assets[2].type, .video)
        XCTAssertNil(timeline.assets[3].lat)
        XCTAssertEqual(timeline.assets[0].liked, true)
        XCTAssertNil(timeline.assets[1].liked)
        XCTAssertEqual(timeline.trip?.start?.name, "Hamburg")
        XCTAssertNil(timeline.trip?.end)
        XCTAssertEqual(timeline.route?.count, 3)
        XCTAssertEqual(timeline.route?[1].points.last, RouteLeg.Point(lat: 62.1, lng: 7.2, time: 1_780_311_600))
        XCTAssertEqual(timeline.tour.highlightMin, 5)
    }

    /// Recorded from the real backend (ios/e2e/start.sh, public link).
    func testDecodesRecordedBackendResponse() throws {
        let timeline = try fixture("server-timeline")
        XCTAssertEqual(timeline.assets.map(\.id), ["p1", "p1b", "nx", "p2", "p3", "p4"])
        XCTAssertNil(timeline.route)
        XCTAssertEqual(timeline.accent, "ozean")
        XCTAssertEqual(timeline.assets[0].caption, "Bryggen am Morgen")
        XCTAssertEqual(timeline.assets[0].liked, true)
        XCTAssertEqual(timeline.assets[3].comments.first?.author, "Ben")
        XCTAssertEqual(timeline.albumComments.count, 1)
        XCTAssertEqual(timeline.trip?.start?.name, "Hamburg")
    }

    func testDecodesOldServersWithoutOptionalFields() throws {
        let json = """
        {"title":"Alt","description":null,"startDate":null,"endDate":null,"captionSource":"none",
         "albumComments":[],"tour":{"intervalSeconds":5,"radiusMeters":2000,"videoMaxSeconds":0},
         "assets":[{"id":"a","type":"image","takenAt":"2026-01-01T00:00:00.000Z",
                    "localDateTime":"2026-01-01T00:00:00.000Z","caption":null,"comments":[],
                    "lat":null,"lng":null,"width":null,"height":null,"city":null,"country":null}]}
        """
        let timeline = try JSONDecoder().decode(Timeline.self, from: Data(json.utf8))
        XCTAssertNil(timeline.route)
        XCTAssertNil(timeline.trip)
        XCTAssertNil(timeline.accent)
        XCTAssertNil(timeline.assets[0].aspectRatio)
        XCTAssertEqual(timeline.assets[0].place, "")
    }

    func testAspectRatioAndPlace() throws {
        let asset = try fixture().assets[1]
        XCTAssertEqual(asset.aspectRatio ?? 0, 0.75, accuracy: 0.001)
        XCTAssertEqual(asset.place, "Bergen, Norwegen")
    }
}

final class LinkTests: XCTestCase {
    func testParsesTimelineLink() throws {
        let link = try XCTUnwrap(ParsedLink.parse("https://fotos.example.de/t/AbC-12_x"))
        XCTAssertEqual(link.source, .server(base: URL(string: "https://fotos.example.de")!, token: "AbC-12_x"))
        XCTAssertNil(link.photoId)
        XCTAssertEqual(link.source.timelineURL.absoluteString, "https://fotos.example.de/api/public/timeline/AbC-12_x")
        XCTAssertEqual(link.source.unlockURL?.absoluteString, "https://fotos.example.de/api/public/timeline/AbC-12_x/unlock")
        XCTAssertEqual(
            link.source.mediaURL("p1", .preview).absoluteString,
            "https://fotos.example.de/api/public/timeline/AbC-12_x/assets/p1/preview"
        )
    }

    func testParsesPhotoLinkInsideMessage() throws {
        let link = try XCTUnwrap(ParsedLink.parse("Schau mal: https://fotos.example.de/t/tok123?foto=abc-1 😊"))
        XCTAssertEqual(link.photoId, "abc-1")
        XCTAssertEqual(link.source.photoURL("p2").absoluteString, "https://fotos.example.de/t/tok123?foto=p2")
    }

    func testKeepsPathPrefixAndPort() throws {
        let link = try XCTUnwrap(ParsedLink.parse("http://192.168.1.5:8080/timeline/t/tok/"))
        XCTAssertEqual(link.source.timelineURL.absoluteString, "http://192.168.1.5:8080/timeline/api/public/timeline/tok")
        XCTAssertEqual(link.source.webURL.absoluteString, "http://192.168.1.5:8080/timeline/t/tok")
    }

    func testAddsHttpsWithoutScheme() throws {
        let link = try XCTUnwrap(ParsedLink.parse("fotos.example.de/t/tok"))
        XCTAssertEqual(link.source.webURL.absoluteString, "https://fotos.example.de/t/tok")
    }

    func testRejectsOtherLinks() {
        XCTAssertNil(ParsedLink.parse(""))
        XCTAssertNil(ParsedLink.parse("hallo"))
        XCTAssertNil(ParsedLink.parse("https://example.de/admin"))
        XCTAssertNil(ParsedLink.parse("https://example.de/t/"))
        XCTAssertNil(ParsedLink.parse("ftp://example.de/t/tok"))
    }

    func testDemoUrls() {
        let demo = TimelineSource.projectDemo
        XCTAssertEqual(demo.timelineURL.absoluteString, "https://dertika.github.io/mediatimeline/demo-data/timeline.json")
        XCTAssertEqual(demo.mediaURL("x", .thumbnail).absoluteString, "https://dertika.github.io/mediatimeline/demo-data/media/x/thumbnail.jpg")
        XCTAssertEqual(demo.mediaURL("x", .video).absoluteString, "https://dertika.github.io/mediatimeline/demo-data/media/x/video.mp4")
        XCTAssertEqual(demo.webURL.absoluteString, "https://dertika.github.io/mediatimeline/demo/")
        XCTAssertNil(demo.unlockURL)
    }

    func testSourceRoundTripsThroughJSON() throws {
        let source = TimelineSource.server(base: URL(string: "https://a.de")!, token: "t")
        let decoded = try JSONDecoder().decode(TimelineSource.self, from: JSONEncoder().encode(source))
        XCTAssertEqual(decoded, source)
    }
}

final class FormatTests: XCTestCase {
    func testFormatsLocalTimeInUTC() {
        XCTAssertEqual(TimelineFormat.day("2026-06-01T09:00:00.000Z"), "Montag, 1. Juni 2026")
        XCTAssertEqual(TimelineFormat.time("2026-06-01T09:05:00.000Z"), "09:05")
        XCTAssertEqual(TimelineFormat.time("2026-06-01T23:30:00Z"), "23:30")
        XCTAssertEqual(TimelineFormat.dayKey("2026-06-01T23:30:00.000Z"), "2026-06-01")
    }

    func testRange() {
        XCTAssertEqual(TimelineFormat.range("2026-06-01T09:00:00.000Z", "2026-06-14T09:00:00.000Z"), "1. Juni 2026 – 14. Juni 2026")
        XCTAssertEqual(TimelineFormat.range("2026-06-01T09:00:00.000Z", "2026-06-01T19:00:00.000Z"), "1. Juni 2026")
        XCTAssertNil(TimelineFormat.range(nil, nil))
    }

    func testCount() {
        XCTAssertEqual(TimelineFormat.count(1, "Foto", "Fotos"), "1 Foto")
        XCTAssertEqual(TimelineFormat.count(3, "Foto", "Fotos"), "3 Fotos")
    }
}

final class GroupingTests: XCTestCase {
    func testGroupsByDay() throws {
        let days = groupByDay(try fixture().assets)
        XCTAssertEqual(days.map(\.id), ["2026-06-01", "2026-06-02", "2026-06-03"])
        XCTAssertEqual(days[0].assets.map(\.id), ["p1", "p1b", "v1"])
        XCTAssertEqual(days[1].label, "Dienstag, 2. Juni 2026")
    }

    func testBuildsPlaces() throws {
        let stops = buildStops(try fixture().assets, radiusMeters: 2000)
        XCTAssertEqual(stops.map { $0.assets.map(\.id) }, [["p1", "p1b", "v1", "nx"], ["p2"], ["p4"]])
        XCTAssertEqual(stops.map(\.name), ["Bergen, Norwegen", "Geiranger, Norwegen", "Oslo, Norwegen"])
        XCTAssertEqual(stops[0].center.lat, (60.3975 + 60.3925 + 60.395) / 3, accuracy: 1e-9)
        XCTAssertEqual(stops.map(\.index), [0, 1, 2])
        XCTAssertEqual(stops.map(\.coverId), ["p1", "p2", "p4"])
    }

    func testLeadingPhotosWithoutLocationJoinFirstPlace() {
        let assets = [
            TimelineAsset(id: "a", takenAt: "1", localDateTime: "2026-01-01T00:00:00Z"),
            TimelineAsset(id: "b", takenAt: "2", localDateTime: "2026-01-01T01:00:00Z", lat: 1, lng: 1),
        ]
        XCTAssertEqual(buildStops(assets, radiusMeters: 100).first?.assets.map(\.id), ["a", "b"])
        XCTAssertTrue(buildStops([assets[0]], radiusMeters: 100).isEmpty)
    }

    func testExtraComments() {
        let comments = [TimelineComment(author: "A", text: "Erster", createdAt: "1"), TimelineComment(author: "B", text: "Zweiter", createdAt: "2")]
        var asset = TimelineAsset(id: "a", takenAt: "1", localDateTime: "1", caption: "Erster", comments: comments)
        XCTAssertEqual(extraComments(asset, captionSource: "firstComment").map(\.text), ["Zweiter"])
        XCTAssertEqual(extraComments(asset, captionSource: "descriptionOrFirstComment").map(\.text), ["Zweiter"])
        XCTAssertEqual(extraComments(asset, captionSource: "description").count, 2)
        asset.caption = "Beschreibung"
        XCTAssertEqual(extraComments(asset, captionSource: "descriptionOrFirstComment").count, 2)
    }

    func testDistance() {
        let bergen = Coordinate(lat: 60.3913, lng: 5.3221)
        let oslo = Coordinate(lat: 59.9139, lng: 10.7522)
        XCTAssertEqual(distanceMeters(bergen, oslo), 305_000, accuracy: 1_000)
    }

    func testRouteLegend() throws {
        let legend = RouteMode.legend(try fixture().route ?? [])
        XCTAssertEqual(legend.map(\.label), ["Auto", "Schiff"])
        XCTAssertEqual(RouteMode.of("SKATEBOARD").label, "Unterwegs")
    }

    func testAccent() {
        XCTAssertEqual(Accent.of("fjord").light, "#0f6e78")
        XCTAssertEqual(Accent.of(nil).id, "gruen")
        XCTAssertEqual(Accent.of("pink").id, "gruen")
        let c = rgb(hex: "#2f6f5e")
        XCTAssertEqual(c.red, 47 / 255, accuracy: 1e-9)
        XCTAssertEqual(c.blue, 94 / 255, accuracy: 1e-9)
    }

    /// Same ids and colours as the web app (frontend/src/lib/accents.ts).
    func testAccentsMatchWebApp() throws {
        let file = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("frontend/src/lib/accents.ts")
        let source = try String(contentsOf: file, encoding: .utf8)
        for accent in Accent.all {
            let line = "{ id: \"\(accent.id)\", label: \"\(accent.label)\", light: \"\(accent.light)\", dark: \"\(accent.dark)\", darkText: \"\(accent.darkText)\" }"
            XCTAssertTrue(source.contains(line), "accents.ts has no \(line)")
        }
        let webCount = source.components(separatedBy: "{ id: \"").count - 1
        XCTAssertEqual(webCount, Accent.all.count)
    }
}

final class StorageTests: XCTestCase {
    private var defaults: UserDefaults!

    override func setUp() {
        defaults = UserDefaults(suiteName: "test-\(UUID().uuidString)")
    }

    func testSeenMedia() throws {
        let assets = try fixture().assets
        let seen = SeenMedia(source: .projectDemo, defaults: defaults)
        XCTAssertNil(seen.load())
        XCTAssertEqual(SeenMedia.newIds(assets, seen: nil), [])
        seen.save(["p1", "p1b", "gone"], assets: assets)
        XCTAssertEqual(seen.load(), ["p1", "p1b"])
        XCTAssertEqual(SeenMedia.newIds(assets, seen: seen.load()), ["v1", "nx", "p2", "p4"])
    }

    func testSavedLinks() {
        let store = SavedLinkStore(defaults: defaults)
        let a = TimelineSource.server(base: URL(string: "https://a.de")!, token: "1")
        store.upsert(SavedLink(source: a, title: "Norwegen", coverAssetId: "p1", lastOpened: Date(timeIntervalSince1970: 1)))
        store.upsert(SavedLink(source: .projectDemo, lastOpened: Date(timeIntervalSince1970: 2)))
        // Reopening without a title (password screen) keeps the known one.
        let links = store.upsert(SavedLink(source: a, lastOpened: Date(timeIntervalSince1970: 3)))
        XCTAssertEqual(links.map(\.source), [a, .projectDemo])
        XCTAssertEqual(links[0].title, "Norwegen")
        XCTAssertEqual(links[0].coverAssetId, "p1")
        XCTAssertEqual(store.remove(a.id).map(\.source), [.projectDemo])
    }
}

final class APITests: XCTestCase {
    func testErrorStatus() {
        XCTAssertEqual(TimelineAPI.error(status: 404), .notFound)
        XCTAssertEqual(TimelineAPI.error(status: 410), .expired)
        XCTAssertEqual(TimelineAPI.error(status: 429), .tooManyAttempts)
        XCTAssertEqual(TimelineAPI.error(status: 502), .server(status: 502))
    }
}
