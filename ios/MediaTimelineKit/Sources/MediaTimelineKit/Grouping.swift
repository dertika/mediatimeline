import Foundation

/// The photos and videos of one day.
public struct DayGroup: Identifiable, Hashable, Sendable {
    /// "2026-06-01"
    public var id: String
    /// "Montag, 1. Juni 2026"
    public var label: String
    public var assets: [TimelineAsset]
}

/// Groups the chronologically sorted assets by their local day.
public func groupByDay(_ assets: [TimelineAsset]) -> [DayGroup] {
    var groups: [DayGroup] = []
    for asset in assets {
        let day = TimelineFormat.dayKey(asset.localDateTime)
        if groups.last?.id != day {
            groups.append(DayGroup(id: day, label: TimelineFormat.day(asset.localDateTime), assets: []))
        }
        groups[groups.count - 1].assets.append(asset)
    }
    return groups
}

public struct Coordinate: Hashable, Sendable {
    public var lat: Double
    public var lng: Double

    public init(lat: Double, lng: Double) {
        self.lat = lat
        self.lng = lng
    }
}

private let earthRadiusMeters = 6_371_000.0

/// Great-circle distance in meters.
public func distanceMeters(_ a: Coordinate, _ b: Coordinate) -> Double {
    let rad = Double.pi / 180
    let dLat = (b.lat - a.lat) * rad
    let dLng = (b.lng - a.lng) * rad
    let h = pow(sin(dLat / 2), 2) + cos(a.lat * rad) * cos(b.lat * rad) * pow(sin(dLng / 2), 2)
    return 2 * earthRadiusMeters * asin(min(1, sqrt(h)))
}

/// A place of the trip: consecutive photos within the tour radius (as the web tour's stops).
public struct PlaceStop: Identifiable, Hashable, Sendable {
    public var index: Int
    /// Mean position of the located photos.
    public var center: Coordinate
    /// All assets in chronological order, including those without GPS.
    public var assets: [TimelineAsset]

    public var id: Int { index }

    /// The first photo with a location, used as the marker image.
    public var coverId: String { (assets.first { $0.hasLocation } ?? assets[0]).id }

    /// "Bergen, Norwegen" from the first photo that knows it.
    public var name: String { assets.lazy.map(\.place).first { !$0.isEmpty } ?? "" }
}

/// Splits the sorted assets into places. A new place starts when a located photo
/// is farther than `radiusMeters` from the current center; returning to an
/// earlier place later is a new place. Photos without GPS stay with the current
/// place (leading ones join the first).
public func buildStops(_ assets: [TimelineAsset], radiusMeters: Double) -> [PlaceStop] {
    var stops: [(stop: PlaceStop, located: [Coordinate])] = []
    var leading: [TimelineAsset] = []

    for asset in assets {
        guard let lat = asset.lat, let lng = asset.lng else {
            if stops.isEmpty { leading.append(asset) } else { stops[stops.count - 1].stop.assets.append(asset) }
            continue
        }
        let pos = Coordinate(lat: lat, lng: lng)
        if let current = stops.last, distanceMeters(current.stop.center, pos) <= radiusMeters {
            var entry = stops.removeLast()
            entry.stop.assets.append(asset)
            entry.located.append(pos)
            let n = Double(entry.located.count)
            entry.stop.center = Coordinate(
                lat: entry.located.reduce(0) { $0 + $1.lat } / n,
                lng: entry.located.reduce(0) { $0 + $1.lng } / n
            )
            stops.append(entry)
        } else {
            stops.append((PlaceStop(index: stops.count, center: pos, assets: leading + [asset]), [pos]))
            leading = []
        }
    }
    return stops.map { $0.stop }
}

/// Colour and German name of a GeoPulse movement type, as in the web legend.
public struct RouteMode: Hashable, Sendable {
    /// "#2563eb"
    public var color: String
    public var label: String

    private static let modes: [String: RouteMode] = [
        "WALK": RouteMode(color: "#16a34a", label: "zu Fuß"),
        "RUNNING": RouteMode(color: "#16a34a", label: "zu Fuß"),
        "BICYCLE": RouteMode(color: "#65a30d", label: "Fahrrad"),
        "CAR": RouteMode(color: "#2563eb", label: "Auto"),
        "MOTORCYCLE": RouteMode(color: "#2563eb", label: "Motorrad"),
        "PUBLIC_TRANSPORT": RouteMode(color: "#9333ea", label: "Bus & Bahn"),
        "TRAIN": RouteMode(color: "#9333ea", label: "Zug"),
        "BOAT": RouteMode(color: "#0891b2", label: "Schiff"),
        "FLIGHT": RouteMode(color: "#64748b", label: "Flug"),
    ]
    private static let other = RouteMode(color: "#d97706", label: "Unterwegs")

    public static func of(_ mode: String) -> RouteMode { modes[mode] ?? other }

    /// The modes of a route for the legend, each once, in order of appearance.
    public static func legend(_ route: [RouteLeg]) -> [RouteMode] {
        var seen = Set<String>()
        return route.map { of($0.mode) }.filter { seen.insert($0.label).inserted }
    }
}

/// Curated accent colours a link can use (ids as in backend/src/accent.ts).
public struct Accent: Hashable, Sendable {
    public var id: String
    public var label: String
    /// Accent in light mode, white text on it.
    public var light: String
    /// Accent in dark mode, with `darkText` on it.
    public var dark: String
    public var darkText: String

    public static let all: [Accent] = [
        Accent(id: "gruen", label: "Waldgrün", light: "#2f6f5e", dark: "#6cc2a8", darkText: "#0d1f19"),
        Accent(id: "ozean", label: "Ozeanblau", light: "#1f5f8b", dark: "#7cb8e4", darkText: "#0b1d2b"),
        Accent(id: "fjord", label: "Fjordtürkis", light: "#0f6e78", dark: "#5cc6cf", darkText: "#06262a"),
        Accent(id: "terrakotta", label: "Terrakotta", light: "#b0502a", dark: "#f0a37a", darkText: "#2a1309"),
        Accent(id: "aubergine", label: "Aubergine", light: "#6a3d9a", dark: "#c3a3e8", darkText: "#1f1030"),
    ]

    /// The accent of a link; unknown or missing ids get the default (Waldgrün).
    public static func of(_ id: String?) -> Accent { all.first { $0.id == id } ?? all[0] }
}

/// RGB components (0…1) of "#rrggbb".
public func rgb(hex: String) -> (red: Double, green: Double, blue: Double) {
    let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
    let value = UInt32(digits, radix: 16) ?? 0
    return (Double((value >> 16) & 0xFF) / 255, Double((value >> 8) & 0xFF) / 255, Double(value & 0xFF) / 255)
}

/// Comments shown below a photo: without the first one when it already is the caption.
public func extraComments(_ asset: TimelineAsset, captionSource: String?) -> [TimelineComment] {
    let firstIsCaption = captionSource == "firstComment"
        || (captionSource == "descriptionOrFirstComment" && asset.caption != nil && asset.caption == asset.comments.first?.text)
    return firstIsCaption ? Array(asset.comments.dropFirst()) : asset.comments
}
