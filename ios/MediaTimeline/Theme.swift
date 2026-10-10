import MediaTimelineKit
import SwiftUI
import UIKit

extension Color {
    /// "#rrggbb"
    init(hex: String) {
        let c = rgb(hex: hex)
        self.init(red: c.red, green: c.green, blue: c.blue)
    }

    /// The link's accent, with the dark variant in dark mode (as on the web page).
    init(accent: Accent) {
        self.init(uiColor: UIColor { traits in
            let c = rgb(hex: traits.userInterfaceStyle == .dark ? accent.dark : accent.light)
            return UIColor(red: c.red, green: c.green, blue: c.blue, alpha: 1)
        })
    }

    /// Text on the accent colour.
    init(onAccent accent: Accent) {
        self.init(uiColor: UIColor { traits in
            guard traits.userInterfaceStyle == .dark else { return .white }
            let c = rgb(hex: accent.darkText)
            return UIColor(red: c.red, green: c.green, blue: c.blue, alpha: 1)
        })
    }
}

enum AppInfo {
    static var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
    }
}
