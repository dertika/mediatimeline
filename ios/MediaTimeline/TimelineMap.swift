import MapKit
import MediaTimelineKit
import SwiftUI

extension Coordinate {
    var clLocation: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: lat, longitude: lng) }
}

/// The places of the trip with a photo each, start and destination, and the
/// GeoPulse route by means of transport (or a dashed line between the places).
struct TimelineMap: View {
    var timeline: Timeline
    var stops: [PlaceStop]
    var source: TimelineSource
    var accent: Accent
    var markerSize: CGFloat = 40
    /// Tapped place: the id of its first asset.
    var select: (String) -> Void

    @State private var position = MapCameraPosition.automatic

    var body: some View {
        Map(position: $position) {
            if let route = timeline.route, !route.isEmpty {
                ForEach(Array(route.enumerated()), id: \.offset) { _, leg in
                    MapPolyline(coordinates: leg.points.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lng) })
                        .stroke(Color(hex: RouteMode.of(leg.mode).color), style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
                }
            } else if itinerary.count > 1 {
                MapPolyline(coordinates: itinerary)
                    .stroke(Color(accent: accent).opacity(0.8), style: StrokeStyle(lineWidth: 3, lineCap: .round, dash: [6, 6]))
            }

            if let start = timeline.trip?.start {
                Marker(start.name, systemImage: "house.fill", coordinate: CLLocationCoordinate2D(latitude: start.lat, longitude: start.lng))
                    .tint(.gray)
            }
            if let end = timeline.trip?.end, end != timeline.trip?.start {
                Marker(end.name, systemImage: "flag.checkered", coordinate: CLLocationCoordinate2D(latitude: end.lat, longitude: end.lng))
                    .tint(.gray)
            }

            ForEach(stops) { stop in
                Annotation(stop.name, coordinate: stop.center.clLocation, anchor: .center) {
                    Button {
                        select(stop.assets[0].id)
                    } label: {
                        PlaceMarker(url: source.mediaURL(stop.coverId, .thumbnail), count: stop.assets.count, size: markerSize, accent: accent)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(stop.name.isEmpty ? "Ort \(stop.index + 1)" : stop.name)
                }
                .annotationTitles(.hidden)
            }
        }
        .mapStyle(.standard(pointsOfInterest: .excludingAll))
    }

    /// Start, places, destination in order – the line when there is no recorded route.
    private var itinerary: [CLLocationCoordinate2D] {
        var points = stops.map(\.center.clLocation)
        if let start = timeline.trip?.start {
            points.insert(CLLocationCoordinate2D(latitude: start.lat, longitude: start.lng), at: 0)
        }
        if let end = timeline.trip?.end {
            points.append(CLLocationCoordinate2D(latitude: end.lat, longitude: end.lng))
        }
        return points
    }
}

private struct PlaceMarker: View {
    var url: URL
    var count: Int
    var size: CGFloat
    var accent: Accent

    var body: some View {
        RemoteImage(thumbnail: url)
            .frame(width: size, height: size)
            .clipShape(Circle())
            .overlay(Circle().stroke(.white, lineWidth: 2.5))
            .shadow(color: .black.opacity(0.3), radius: 3, y: 1)
            .overlay(alignment: .topTrailing) {
                if count > 1 {
                    Text("\(count)")
                        .font(.caption2.bold())
                        .foregroundStyle(Color(onAccent: accent))
                        .padding(.horizontal, 5)
                        .frame(minWidth: 18, minHeight: 18)
                        .background(Color(accent: accent), in: Capsule())
                        .offset(x: 6, y: -6)
                }
            }
    }
}

/// Legend of the means of transport of the recorded route.
struct RouteLegend: View {
    var route: [RouteLeg]

    var body: some View {
        let modes = RouteMode.legend(route)
        if !modes.isEmpty {
            HStack(spacing: 12) {
                ForEach(modes, id: \.label) { mode in
                    HStack(spacing: 4) {
                        Capsule().fill(Color(hex: mode.color)).frame(width: 16, height: 4)
                        Text(mode.label)
                    }
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
    }
}

/// The map in the timeline, with a button to enlarge it.
struct MapCard: View {
    var timeline: Timeline
    var stops: [PlaceStop]
    var source: TimelineSource
    var accent: Accent
    var expand: () -> Void
    var select: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            TimelineMap(timeline: timeline, stops: stops, source: source, accent: accent, markerSize: 34, select: select)
                .frame(height: 280)
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .overlay(alignment: .topTrailing) {
                    Button(action: expand) {
                        Image(systemName: "arrow.up.left.and.arrow.down.right")
                            .font(.footnote.bold())
                            .padding(9)
                            .background(.regularMaterial, in: Circle())
                    }
                    .padding(8)
                    .accessibilityLabel("Karte vergrößern")
                    .accessibilityIdentifier("expandMap")
                }
            if let route = timeline.route {
                RouteLegend(route: route)
            }
        }
    }
}

/// The map on the whole screen.
struct FullMapView: View {
    var timeline: Timeline
    var stops: [PlaceStop]
    var source: TimelineSource
    var accent: Accent
    var select: (String) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            TimelineMap(timeline: timeline, stops: stops, source: source, accent: accent, markerSize: 46, select: select)
                .ignoresSafeArea(edges: .bottom)
                .safeAreaInset(edge: .bottom) {
                    if let route = timeline.route, !route.isEmpty {
                        RouteLegend(route: route)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(.regularMaterial, in: Capsule())
                            .padding(.bottom, 8)
                    }
                }
                .navigationTitle(timeline.title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Fertig") { dismiss() }
                    }
                }
        }
        .tint(Color(accent: accent))
    }
}
