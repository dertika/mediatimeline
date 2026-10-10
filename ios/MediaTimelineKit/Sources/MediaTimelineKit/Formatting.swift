import Foundation

/// Dates as the web app shows them. Immich's `localDateTime` is the wall-clock
/// time at the place a photo was taken, encoded as if it were UTC, so it is
/// always parsed and formatted in UTC.
public enum TimelineFormat {
    private static let utc = TimeZone(identifier: "UTC")!
    private static let german = Locale(identifier: "de_DE")

    private static func formatter(_ format: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = german
        f.timeZone = utc
        f.setLocalizedDateFormatFromTemplate(format)
        return f
    }

    private static let dayFormatter = formatter("EEEEdMMMMyyyy")
    private static let shortDayFormatter = formatter("EEEdMMMMyyyy")
    private static let dateFormatter = formatter("dMMMMyyyy")
    private static let timeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = german
        f.timeZone = utc
        f.dateFormat = "HH:mm"
        return f
    }()

    private static let isoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let iso = ISO8601DateFormatter()

    public static func parse(_ string: String) -> Date? {
        isoFractional.date(from: string) ?? iso.date(from: string)
    }

    /// "2026-06-01" – the day a photo belongs to.
    public static func dayKey(_ local: String) -> String {
        String(local.prefix(10))
    }

    /// "Montag, 1. Juni 2026"
    public static func day(_ local: String) -> String {
        parse(local).map { dayFormatter.string(from: $0) } ?? dayKey(local)
    }

    /// "09:00"
    public static func time(_ local: String) -> String {
        parse(local).map { timeFormatter.string(from: $0) } ?? ""
    }

    /// "Mo., 1. Juni 2026 · 09:00" – shown in the gallery.
    public static func dayTime(_ local: String) -> String {
        guard let date = parse(local) else { return "" }
        return "\(shortDayFormatter.string(from: date)) · \(timeFormatter.string(from: date))"
    }

    /// "1. Juni 2026 – 14. Juni 2026", or a single date for one day.
    public static func range(_ start: String?, _ end: String?) -> String? {
        guard let start, let s = parse(start) else { return nil }
        guard let end, let e = parse(end), dayKey(start) != dayKey(end) else { return dateFormatter.string(from: s) }
        return "\(dateFormatter.string(from: s)) – \(dateFormatter.string(from: e))"
    }

    /// "1 Foto", "3 Fotos" …
    public static func count(_ n: Int, _ one: String, _ many: String) -> String {
        "\(n) \(n == 1 ? one : many)"
    }
}
