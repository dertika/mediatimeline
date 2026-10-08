import MediaTimelineKit
import SwiftUI

/// Which asset the fullscreen gallery opens with.
struct GalleryStart: Identifiable {
    var id: String
}

/// The timeline: header, map, days with their photos and videos.
struct TimelineContentView: View {
    var source: TimelineSource
    var timeline: Timeline
    var photoId: String?
    var refresh: () async -> Void

    @State private var gallery: GalleryStart?
    @State private var showMap = false
    /// Asset to scroll to; set, then handled by the ScrollViewReader.
    @State private var scrollTarget: String?
    @State private var didOpenPhoto = false
    /// New since the last visit and not seen yet, in timeline order.
    @State private var unseen: [String] = []
    /// New at the time of loading: keeps the "Neu" badge while the page is open.
    @State private var newIds: Set<String> = []
    /// Assets currently on screen (for "zum nächsten neuen Foto").
    @State private var visible: Set<String> = []

    private var accent: Accent { Accent.of(timeline.accent) }
    private var days: [DayGroup] { groupByDay(timeline.assets) }
    private var stops: [PlaceStop] { buildStops(timeline.assets, radiusMeters: timeline.tour.radiusMeters) }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                    header
                        .padding(.horizontal, 16)
                        .padding(.top, 8)
                        .padding(.bottom, 16)

                    if timeline.assets.contains(where: \.hasLocation) || timeline.trip?.start != nil {
                        MapCard(timeline: timeline, stops: stops, source: source, accent: accent, expand: { showMap = true }) { id in
                            scrollTarget = id
                        }
                        .padding(.horizontal, 16)
                        .padding(.bottom, 8)
                    }

                    ForEach(days) { day in
                        Section {
                            ForEach(day.assets) { asset in
                                AssetRow(
                                    asset: asset,
                                    source: source,
                                    comments: extraComments(asset, captionSource: timeline.captionSource),
                                    isNew: newIds.contains(asset.id),
                                    accent: accent
                                ) {
                                    gallery = GalleryStart(id: asset.id)
                                }
                                .id(asset.id)
                                .padding(.horizontal, 16)
                                .padding(.bottom, 24)
                                .onAppear { visible.insert(asset.id) }
                                .onDisappear { visible.remove(asset.id) }
                                .task(id: unseen.contains(asset.id)) {
                                    // Seen once it stayed on screen for a moment.
                                    guard unseen.contains(asset.id) else { return }
                                    try? await Task.sleep(for: .milliseconds(800))
                                    if !Task.isCancelled { markSeen([asset.id]) }
                                }
                            }
                        } header: {
                            DayHeader(label: day.label)
                        }
                    }

                    Text("Erstellt mit mediatimeline · v\(AppInfo.version)")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 24)
                        .padding(.bottom, unseen.isEmpty ? 0 : 64)
                }
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
            }
            .refreshable { await refresh() }
            .onChange(of: scrollTarget) { _, id in
                guard let id else { return }
                scroll(proxy, to: id)
                scrollTarget = nil
            }
            .onAppear {
                guard !didOpenPhoto, let photoId, timeline.assets.contains(where: { $0.id == photoId }) else { return }
                didOpenPhoto = true
                scroll(proxy, to: photoId, animated: false)
            }
        }
        .overlay(alignment: .bottom) {
            if !unseen.isEmpty {
                NewMediaPill(count: unseen.count, accent: accent, next: nextNew) {
                    markSeen(unseen)
                }
                .padding(.bottom, 12)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.spring(duration: 0.3), value: unseen.isEmpty)
        .navigationTitle(timeline.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                ShareLink(item: source.webURL, subject: Text(timeline.title)) {
                    Image(systemName: "square.and.arrow.up")
                }
                .accessibilityLabel("Timeline teilen")
            }
        }
        .tint(Color(accent: accent))
        .fullScreenCover(item: $gallery) { start in
            GalleryView(source: source, timeline: timeline, startId: start.id) { lastShown in
                markSeen([lastShown])
                scrollTarget = lastShown
            }
        }
        .fullScreenCover(isPresented: $showMap) {
            FullMapView(timeline: timeline, stops: stops, source: source, accent: accent) { id in
                showMap = false
                scrollTarget = id
            }
        }
        .onAppear(perform: loadSeen)
        .onChange(of: timeline.assets.map(\.id)) { loadSeen() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(timeline.title)
                .font(.largeTitle.bold())
                .accessibilityIdentifier("timelineTitle")
            Text(summary)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            if let description = timeline.description, !description.isEmpty {
                Text(description)
                    .padding(.top, 4)
            }
            if !timeline.albumComments.isEmpty {
                CommentList(comments: timeline.albumComments, label: "Kommentare zum Album")
                    .padding(.top, 6)
            }
        }
    }

    /// "1. Juni 2026 – 14. Juni 2026 · 120 Fotos · 4 Videos"
    private var summary: String {
        let videos = timeline.assets.filter { $0.type == .video }.count
        var parts = [TimelineFormat.range(timeline.startDate, timeline.endDate)].compactMap { $0 }
        parts.append(TimelineFormat.count(timeline.assets.count - videos, "Foto", "Fotos"))
        if videos > 0 { parts.append(TimelineFormat.count(videos, "Video", "Videos")) }
        return parts.joined(separator: " · ")
    }

    private func scroll(_ proxy: ScrollViewProxy, to id: String, animated: Bool = true) {
        if let asset = timeline.assets.first(where: { $0.id == id }) {
            ImagePipeline.shared.prefetch(source.mediaURL(asset.id, .preview))
        }
        // The lazy stack only estimates far rows: jump, then correct once they are laid out.
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(50))
            if animated {
                withAnimation { proxy.scrollTo(id, anchor: .center) }
            } else {
                proxy.scrollTo(id, anchor: .center)
            }
            try? await Task.sleep(for: .milliseconds(400))
            proxy.scrollTo(id, anchor: .center)
        }
    }

    // MARK: New photos

    private func loadSeen() {
        let stored = SeenMedia(source: source).load()
        if stored == nil {
            // First visit: everything counts as seen.
            SeenMedia(source: source).save(Set(timeline.assets.map(\.id)), assets: timeline.assets)
        }
        unseen = SeenMedia.newIds(timeline.assets, seen: stored)
        newIds.formUnion(unseen)
    }

    private func markSeen(_ ids: [String]) {
        let fresh = Set(ids).intersection(unseen)
        guard !fresh.isEmpty else { return }
        unseen.removeAll { fresh.contains($0) }
        let seen = Set(timeline.assets.map(\.id)).subtracting(unseen)
        SeenMedia(source: source).save(seen, assets: timeline.assets)
    }

    /// The next new photo below the ones on screen, else the first one.
    private func nextNew() {
        let order = Dictionary(uniqueKeysWithValues: timeline.assets.enumerated().map { ($1.id, $0) })
        let lastVisible = visible.compactMap { order[$0] }.max() ?? -1
        guard let id = unseen.first(where: { (order[$0] ?? 0) > lastVisible }) ?? unseen.first else { return }
        scrollTarget = id
        markSeen([id])
    }
}

private struct DayHeader: View {
    var label: String

    var body: some View {
        Text(label)
            .font(.headline)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(.bar)
    }
}

/// "3 neue Fotos · Zum nächsten ↓" with a button to dismiss.
private struct NewMediaPill: View {
    var count: Int
    var accent: Accent
    var next: () -> Void
    var dismiss: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            Button(action: next) {
                HStack(spacing: 8) {
                    Text(count == 1 ? "1 neues Foto" : "\(count) neue Fotos").bold()
                    Text("Zum nächsten").opacity(0.85)
                    Image(systemName: "arrow.down")
                }
                .padding(.leading, 18)
                .padding(.trailing, 12)
                .padding(.vertical, 12)
            }
            .accessibilityIdentifier("nextNew")
            Divider().frame(height: 22).overlay(Color(onAccent: accent).opacity(0.4))
            Button(action: dismiss) {
                Image(systemName: "xmark")
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
            }
            .accessibilityLabel("Hinweis auf neue Fotos ausblenden")
        }
        .font(.subheadline)
        .foregroundStyle(Color(onAccent: accent))
        .background(Color(accent: accent), in: Capsule())
        .shadow(color: .black.opacity(0.25), radius: 10, y: 4)
    }
}
