import Foundation

/// A comment from the shared Immich album.
public struct TimelineComment: Codable, Hashable, Sendable {
    public var author: String
    public var text: String
    public var createdAt: String

    public init(author: String, text: String, createdAt: String) {
        self.author = author
        self.text = text
        self.createdAt = createdAt
    }
}

public enum AssetType: String, Codable, Sendable {
    case image
    case video
}

/// A photo or video as delivered by `/api/public/timeline/:token`.
public struct TimelineAsset: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var type: AssetType
    /// Instant the photo was taken (ISO, UTC), used for sorting.
    public var takenAt: String
    /// Wall-clock time at the place it was taken, encoded as if it were UTC.
    public var localDateTime: String
    public var caption: String?
    public var comments: [TimelineComment]
    public var lat: Double?
    public var lng: Double?
    public var width: Int?
    public var height: Int?
    public var city: String?
    public var country: String?
    /// Liked in Immich or a favorite of the owner; missing from older servers.
    public var liked: Bool?

    public init(
        id: String, type: AssetType = .image, takenAt: String, localDateTime: String,
        caption: String? = nil, comments: [TimelineComment] = [], lat: Double? = nil, lng: Double? = nil,
        width: Int? = nil, height: Int? = nil, city: String? = nil, country: String? = nil, liked: Bool? = nil
    ) {
        self.id = id
        self.type = type
        self.takenAt = takenAt
        self.localDateTime = localDateTime
        self.caption = caption
        self.comments = comments
        self.lat = lat
        self.lng = lng
        self.width = width
        self.height = height
        self.city = city
        self.country = country
        self.liked = liked
    }

    public var hasLocation: Bool { lat != nil && lng != nil }

    /// Width / height, if known.
    public var aspectRatio: Double? {
        guard let width, let height, width > 0, height > 0 else { return nil }
        return Double(width) / Double(height)
    }

    /// "Bergen, Norwegen" – empty if unknown.
    public var place: String {
        [city, country].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: ", ")
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        type = try c.decode(AssetType.self, forKey: .type)
        takenAt = try c.decode(String.self, forKey: .takenAt)
        localDateTime = try c.decode(String.self, forKey: .localDateTime)
        caption = try c.decodeIfPresent(String.self, forKey: .caption)
        comments = try c.decodeIfPresent([TimelineComment].self, forKey: .comments) ?? []
        lat = try c.decodeIfPresent(Double.self, forKey: .lat)
        lng = try c.decodeIfPresent(Double.self, forKey: .lng)
        width = try c.decodeIfPresent(Int.self, forKey: .width)
        height = try c.decodeIfPresent(Int.self, forKey: .height)
        city = try c.decodeIfPresent(String.self, forKey: .city)
        country = try c.decodeIfPresent(String.self, forKey: .country)
        liked = try c.decodeIfPresent(Bool.self, forKey: .liked)
    }
}

/// A place picked in the admin, e.g. the start of a trip.
public struct Place: Codable, Hashable, Sendable {
    public var name: String
    public var lat: Double
    public var lng: Double

    public init(name: String, lat: Double, lng: Double) {
        self.name = name
        self.lat = lat
        self.lng = lng
    }
}

/// Where a trip starts and ends; shown on the map without photos.
public struct Trip: Codable, Hashable, Sendable {
    public var start: Place?
    public var end: Place?

    public init(start: Place? = nil, end: Place? = nil) {
        self.start = start
        self.end = end
    }
}

/// Part of the recorded GeoPulse route with one means of transport.
public struct RouteLeg: Codable, Hashable, Sendable {
    public struct Point: Hashable, Sendable {
        public var lat: Double
        public var lng: Double
        /// Unix time in seconds.
        public var time: Double
    }

    public var mode: String
    public var points: [Point]

    public init(mode: String, points: [Point]) {
        self.mode = mode
        self.points = points
    }

    enum CodingKeys: String, CodingKey { case mode, points }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        mode = try c.decode(String.self, forKey: .mode)
        // Points come as [lat, lng, time] triples.
        let raw = try c.decode([[Double]].self, forKey: .points)
        points = raw.compactMap { p in
            p.count >= 2 ? Point(lat: p[0], lng: p[1], time: p.count > 2 ? p[2] : 0) : nil
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(mode, forKey: .mode)
        try c.encode(points.map { [$0.lat, $0.lng, $0.time] }, forKey: .points)
    }
}

public struct TourSettings: Codable, Hashable, Sendable {
    public var intervalSeconds: Double
    public var radiusMeters: Double
    /// 0 = play videos to the end.
    public var videoMaxSeconds: Double
    public var fromPhoto: Bool?
    public var highlightMin: Int?

    public init(intervalSeconds: Double = 5, radiusMeters: Double = 2000, videoMaxSeconds: Double = 0) {
        self.intervalSeconds = intervalSeconds
        self.radiusMeters = radiusMeters
        self.videoMaxSeconds = videoMaxSeconds
    }
}

/// The JSON of a shared timeline.
public struct Timeline: Codable, Hashable, Sendable {
    public var title: String
    public var description: String?
    public var startDate: String?
    public var endDate: String?
    public var captionSource: String?
    public var albumComments: [TimelineComment]
    public var tour: TourSettings
    public var trip: Trip?
    /// Accent colour id (see `Accent`); missing from older servers.
    public var accent: String?
    public var route: [RouteLeg]?
    public var assets: [TimelineAsset]

    public init(
        title: String, description: String? = nil, startDate: String? = nil, endDate: String? = nil,
        albumComments: [TimelineComment] = [], tour: TourSettings = TourSettings(), trip: Trip? = nil,
        accent: String? = nil, route: [RouteLeg]? = nil, assets: [TimelineAsset]
    ) {
        self.title = title
        self.description = description
        self.startDate = startDate
        self.endDate = endDate
        self.albumComments = albumComments
        self.tour = tour
        self.trip = trip
        self.accent = accent
        self.route = route
        self.assets = assets
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        title = try c.decode(String.self, forKey: .title)
        description = try c.decodeIfPresent(String.self, forKey: .description)
        startDate = try c.decodeIfPresent(String.self, forKey: .startDate)
        endDate = try c.decodeIfPresent(String.self, forKey: .endDate)
        captionSource = try c.decodeIfPresent(String.self, forKey: .captionSource)
        albumComments = try c.decodeIfPresent([TimelineComment].self, forKey: .albumComments) ?? []
        tour = try c.decodeIfPresent(TourSettings.self, forKey: .tour) ?? TourSettings()
        trip = try c.decodeIfPresent(Trip.self, forKey: .trip)
        accent = try c.decodeIfPresent(String.self, forKey: .accent)
        route = try c.decodeIfPresent([RouteLeg].self, forKey: .route)
        assets = try c.decode([TimelineAsset].self, forKey: .assets)
    }
}
