import Foundation

/// Which photos of a link were already seen on this device, so the timeline
/// can point out the ones added since the last visit (as the web app does).
public struct SeenMedia: Sendable {
    private let defaults: UserDefaults
    private let key: String

    public init(source: TimelineSource, defaults: UserDefaults = .standard) {
        self.defaults = defaults
        key = "seen:\(source.id)"
    }

    /// The seen asset IDs, or nil on the first visit.
    public func load() -> Set<String>? {
        (defaults.array(forKey: key) as? [String]).map(Set.init)
    }

    /// Stores the seen IDs, limited to assets still in the album.
    public func save(_ seen: Set<String>, assets: [TimelineAsset]) {
        defaults.set(assets.map(\.id).filter { seen.contains($0) }, forKey: key)
    }

    /// IDs of the assets not seen yet, in timeline order; none on the first visit.
    public static func newIds(_ assets: [TimelineAsset], seen: Set<String>?) -> [String] {
        guard let seen else { return [] }
        return assets.map(\.id).filter { !seen.contains($0) }
    }
}
