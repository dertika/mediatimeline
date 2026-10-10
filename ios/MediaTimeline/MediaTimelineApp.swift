import SwiftUI

@main
struct MediaTimelineApp: App {
    init() {
        // Photos are cached by the server headers (thumbnails and previews for a day).
        URLCache.shared = URLCache(memoryCapacity: 64 << 20, diskCapacity: 512 << 20)
        if CommandLine.arguments.contains("-uitest-reset") {
            UserDefaults.standard.removePersistentDomain(forName: Bundle.main.bundleIdentifier ?? "")
            HTTPCookieStorage.shared.removeCookies(since: .distantPast)
        }
    }

    var body: some Scene {
        WindowGroup {
            StartView()
        }
    }
}
