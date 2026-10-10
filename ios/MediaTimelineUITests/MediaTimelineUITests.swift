import XCTest

/// Walks through the app and takes screenshots. The server tests need the
/// backend from ios/e2e/start.sh; their links come in as environment variables
/// (TEST_RUNNER_PUBLIC_LINK / TEST_RUNNER_PASSWORD_LINK for xcodebuild).
final class MediaTimelineUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-uitest-reset"]
    }

    private func link(_ name: String) throws -> String {
        guard let value = ProcessInfo.processInfo.environment[name], !value.isEmpty else {
            throw XCTSkip("\(name) not set (start ios/e2e/start.sh)")
        }
        return value
    }

    /// Attaches a screenshot and, if SCREENSHOT_DIR is set, writes it there as PNG.
    private func screenshot(_ name: String) {
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = ProcessInfo.processInfo.environment["SCREENSHOT_DIR"], !dir.isEmpty {
            try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            try? shot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
        }
    }

    private func open(_ url: String) {
        let field = app.descendants(matching: .any)["linkField"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText(url)
        app.buttons["openLink"].tap()
    }

    private func waitForTimeline(_ title: String = "Norwegen 2026") {
        XCTAssertTrue(app.staticTexts["timelineTitle"].waitForExistence(timeout: 30))
        XCTAssertEqual(app.staticTexts["timelineTitle"].label, title)
        sleep(2) // photos and map tiles
    }

    func testPublicLink() throws {
        let url = try link("PUBLIC_LINK")
        app.launch()
        screenshot("01-start")
        open(url)
        waitForTimeline()
        screenshot("02-timeline")

        app.buttons["asset-p1"].firstMatch.tap()
        XCTAssertTrue(app.buttons["closeGallery"].waitForExistence(timeout: 10))
        sleep(2)
        screenshot("03-gallery")
        app.swipeLeft()
        sleep(2)
        screenshot("04-gallery-next")
        app.buttons["closeGallery"].tap()
        sleep(1)
        screenshot("05-after-gallery")

        app.swipeDown()
        app.swipeDown()
        let expand = app.buttons["expandMap"]
        XCTAssertTrue(expand.waitForExistence(timeout: 10))
        expand.tap()
        sleep(3)
        screenshot("06-map")
        app.buttons["Fertig"].tap()

        app.swipeUp()
        app.swipeUp()
        sleep(1)
        screenshot("07-timeline-scrolled")

        // Back to the start list: the link is saved with its title.
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.staticTexts["Norwegen 2026"].waitForExistence(timeout: 10))
        sleep(1)
        screenshot("07b-start-saved")
    }

    func testPhotoLinkOpensAtPhoto() throws {
        let url = try link("PUBLIC_LINK")
        app.launch()
        open("Schau mal: \(url)?foto=p4")
        // Scrolled down to the photo: the title at the top is not on screen.
        let photo = app.buttons["asset-p4"].firstMatch
        XCTAssertTrue(photo.waitForExistence(timeout: 30))
        sleep(2)
        XCTAssertTrue(photo.isHittable)
        screenshot("08-photo-link")
    }

    func testPasswordLink() throws {
        let url = try link("PASSWORD_LINK")
        app.launch()
        open(url)
        let field = app.secureTextFields["passwordField"]
        XCTAssertTrue(field.waitForExistence(timeout: 30))
        XCTAssertTrue(app.staticTexts["Norwegen 2026"].exists)
        screenshot("09-password")

        field.tap()
        field.typeText("falsch")
        app.buttons["unlock"].tap()
        XCTAssertTrue(app.staticTexts["Das Passwort stimmt nicht."].waitForExistence(timeout: 10))
        screenshot("10-password-wrong")

        field.tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 6) + "fjord")
        app.buttons["unlock"].tap()
        waitForTimeline()
        screenshot("11-password-unlocked")
    }

    func testDemo() throws {
        app.launch()
        app.buttons["openDemo"].tap()
        XCTAssertTrue(app.staticTexts["timelineTitle"].waitForExistence(timeout: 60))
        sleep(4)
        screenshot("12-demo")
        app.swipeUp()
        app.swipeUp()
        sleep(2)
        screenshot("13-demo-scrolled")
    }
}
