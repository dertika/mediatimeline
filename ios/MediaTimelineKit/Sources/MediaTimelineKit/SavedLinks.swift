import Foundation

/// A timeline the user opened, kept for the start list.
public struct SavedLink: Codable, Hashable, Identifiable, Sendable {
    public var source: TimelineSource
    /// Title from the last successful load; nil until then (e.g. password links).
    public var title: String?
    public var dateRange: String?
    /// Asset shown as the cover, if the timeline was loaded.
    public var coverAssetId: String?
    public var lastOpened: Date

    public var id: String { source.id }

    public init(source: TimelineSource, title: String? = nil, dateRange: String? = nil,
                coverAssetId: String? = nil, lastOpened: Date = Date()) {
        self.source = source
        self.title = title
        self.dateRange = dateRange
        self.coverAssetId = coverAssetId
        self.lastOpened = lastOpened
    }
}

/// The saved links, newest first, in UserDefaults.
public struct SavedLinkStore: Sendable {
    private let defaults: UserDefaults
    private let key = "savedLinks"

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func load() -> [SavedLink] {
        guard let data = defaults.data(forKey: key),
              let links = try? JSONDecoder().decode([SavedLink].self, from: data)
        else { return [] }
        return links.sorted { $0.lastOpened > $1.lastOpened }
    }

    public func save(_ links: [SavedLink]) {
        defaults.set(try? JSONEncoder().encode(links), forKey: key)
    }

    /// Adds the link or updates it in place (keeps known title and cover when `link` has none).
    @discardableResult
    public func upsert(_ link: SavedLink) -> [SavedLink] {
        var links = load()
        if let index = links.firstIndex(where: { $0.id == link.id }) {
            var merged = link
            merged.title = link.title ?? links[index].title
            merged.dateRange = link.dateRange ?? links[index].dateRange
            merged.coverAssetId = link.coverAssetId ?? links[index].coverAssetId
            links[index] = merged
        } else {
            links.append(link)
        }
        save(links)
        return load()
    }

    @discardableResult
    public func remove(_ id: String) -> [SavedLink] {
        save(load().filter { $0.id != id })
        return load()
    }
}
