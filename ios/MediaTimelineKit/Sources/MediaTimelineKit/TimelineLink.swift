import Foundation

public enum MediaKind: String, Sendable {
    case thumbnail
    case preview
    case video
}

/// Where a timeline comes from: a mediatimeline server link or the static demo.
public enum TimelineSource: Codable, Hashable, Sendable {
    /// `<base>/t/<token>`; `base` may include a path prefix.
    case server(base: URL, token: String)
    /// The demo on the project page: `<base>/timeline.json`, media as static files.
    case demo(base: URL)

    /// The public demo with free photos from Wikimedia Commons.
    public static let projectDemo = TimelineSource.demo(base: URL(string: "https://dertika.github.io/mediatimeline/demo-data")!)

    /// Stable key, e.g. for the seen photos.
    public var id: String {
        switch self {
        case let .server(base, token): return "\(base.absoluteString)/t/\(token)"
        case let .demo(base): return "demo:\(base.absoluteString)"
        }
    }

    public var isDemo: Bool {
        if case .demo = self { return true }
        return false
    }

    /// Host shown in the list of saved links.
    public var host: String {
        switch self {
        case let .server(base, _): return base.host ?? base.absoluteString
        case .demo: return "Demo"
        }
    }

    public var timelineURL: URL {
        switch self {
        case let .server(base, token): return apiBase(base, token)
        case let .demo(base): return base.appendingPathComponent("timeline.json")
        }
    }

    public var unlockURL: URL? {
        guard case let .server(base, token) = self else { return nil }
        return apiBase(base, token).appendingPathComponent("unlock")
    }

    public func mediaURL(_ assetId: String, _ kind: MediaKind) -> URL {
        switch self {
        case let .server(base, token):
            return apiBase(base, token).appendingPathComponent("assets").appendingPathComponent(assetId)
                .appendingPathComponent(kind.rawValue)
        case let .demo(base):
            return base.appendingPathComponent("media").appendingPathComponent(assetId)
                .appendingPathComponent(kind == .video ? "video.mp4" : "\(kind.rawValue).jpg")
        }
    }

    /// The web page of the timeline, as shared with others.
    public var webURL: URL {
        switch self {
        case let .server(base, token): return base.appendingPathComponent("t").appendingPathComponent(token)
        case let .demo(base): return base.deletingLastPathComponent().appendingPathComponent("demo/")
        }
    }

    /// Link to one photo of the timeline (`?foto=<id>`), as the web app shares it.
    public func photoURL(_ assetId: String) -> URL {
        var components = URLComponents(url: webURL, resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "foto", value: assetId)]
        return components.url!
    }

    private func apiBase(_ base: URL, _ token: String) -> URL {
        base.appendingPathComponent("api/public/timeline").appendingPathComponent(token)
    }
}

/// A link someone shared: the timeline and, optionally, the photo it points to.
public struct ParsedLink: Hashable, Sendable {
    public var source: TimelineSource
    public var photoId: String?

    public init(source: TimelineSource, photoId: String? = nil) {
        self.source = source
        self.photoId = photoId
    }

    /// Reads `https://host[/prefix]/t/<token>[?foto=<id>]` from pasted text,
    /// also when the link is part of a longer message.
    public static func parse(_ text: String) -> ParsedLink? {
        for candidate in candidates(in: text) {
            if let link = parseURL(candidate) { return link }
        }
        return nil
    }

    private static func candidates(in text: String) -> [String] {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        var result = [trimmed]
        if let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) {
            let range = NSRange(trimmed.startIndex..., in: trimmed)
            for match in detector.matches(in: trimmed, range: range) {
                if let url = match.url { result.append(url.absoluteString) }
            }
        }
        return result
    }

    private static func parseURL(_ string: String) -> ParsedLink? {
        var string = string
        if !string.contains("://") { string = "https://" + string }
        guard var components = URLComponents(string: string),
              let scheme = components.scheme?.lowercased(), scheme == "https" || scheme == "http",
              components.host?.isEmpty == false
        else { return nil }

        let segments = components.path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        guard let index = segments.lastIndex(of: "t"), index + 1 < segments.count else { return nil }
        let token = segments[index + 1]
        guard token.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil else { return nil }

        let photo = components.queryItems?.first { $0.name == "foto" }?.value?
            .trimmingCharacters(in: .whitespaces)
        let prefix = segments[..<index].joined(separator: "/")
        components.path = prefix.isEmpty ? "" : "/" + prefix
        components.query = nil
        components.fragment = nil
        guard let base = components.url else { return nil }
        return ParsedLink(source: .server(base: base, token: token), photoId: photo?.isEmpty == false ? photo : nil)
    }
}
