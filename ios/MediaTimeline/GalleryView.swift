import AVKit
import MediaTimelineKit
import SwiftUI
import UIKit

/// Photos and videos on the whole screen: swipe between them, pinch to zoom.
struct GalleryView: View {
    var source: TimelineSource
    var timeline: Timeline
    var startId: String
    /// Called on closing with the asset shown last, so the timeline can scroll there.
    var onClose: (String) -> Void

    @State private var current: String
    @State private var chrome = true
    @Environment(\.dismiss) private var dismiss

    init(source: TimelineSource, timeline: Timeline, startId: String, onClose: @escaping (String) -> Void) {
        self.source = source
        self.timeline = timeline
        self.startId = startId
        self.onClose = onClose
        _current = State(initialValue: startId)
    }

    var body: some View {
        TabView(selection: $current) {
            ForEach(timeline.assets) { asset in
                page(asset)
                    .tag(asset.id)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .background(.black)
        .ignoresSafeArea()
        .overlay(alignment: .top) { if chrome { topBar } }
        .overlay(alignment: .bottom) { if chrome { infoBar } }
        .animation(.easeInOut(duration: 0.2), value: chrome)
        .statusBarHidden(!chrome)
        .preferredColorScheme(.dark)
        .onAppear { prefetchAround(startId) }
        .onChange(of: current) { _, id in prefetchAround(id) }
    }

    @ViewBuilder
    private func page(_ asset: TimelineAsset) -> some View {
        if asset.type == .video {
            VideoPage(url: source.mediaURL(asset.id, .video), poster: source.mediaURL(asset.id, .preview), active: current == asset.id)
        } else {
            ZoomableImage(thumbnail: source.mediaURL(asset.id, .thumbnail), full: source.mediaURL(asset.id, .preview)) {
                chrome.toggle()
            }
        }
    }

    private var asset: TimelineAsset? { timeline.assets.first { $0.id == current } }

    private var topBar: some View {
        HStack {
            Button {
                onClose(current)
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.body.bold())
                    .frame(width: 40, height: 40)
                    .background(.ultraThinMaterial, in: Circle())
            }
            .accessibilityLabel("Schließen")
            .accessibilityIdentifier("closeGallery")
            Spacer()
            if let index = timeline.assets.firstIndex(where: { $0.id == current }) {
                Text("\(index + 1) / \(timeline.assets.count)")
                    .font(.subheadline.monospacedDigit())
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(.ultraThinMaterial, in: Capsule())
            }
            Spacer()
            ShareLink(item: source.photoURL(current)) {
                Image(systemName: "square.and.arrow.up")
                    .font(.body.bold())
                    .frame(width: 40, height: 40)
                    .background(.ultraThinMaterial, in: Circle())
            }
            .accessibilityLabel("Link zu diesem Foto teilen")
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }

    @ViewBuilder
    private var infoBar: some View {
        if let asset {
            VStack(alignment: .leading, spacing: 4) {
                if let caption = asset.caption {
                    Text(caption).font(.body)
                }
                Text([TimelineFormat.dayTime(asset.localDateTime), asset.place].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.footnote)
                    .opacity(0.8)
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.top, 24)
            .padding(.bottom, 12)
            .background(LinearGradient(colors: [.clear, .black.opacity(0.7)], startPoint: .top, endPoint: .bottom))
            .allowsHitTesting(false)
        }
    }

    private func prefetchAround(_ id: String) {
        guard let index = timeline.assets.firstIndex(where: { $0.id == id }) else { return }
        for neighbour in [index + 1, index - 1, index + 2] where timeline.assets.indices.contains(neighbour) {
            let asset = timeline.assets[neighbour]
            if asset.type == .image { ImagePipeline.shared.prefetch(source.mediaURL(asset.id, .preview)) }
        }
    }
}

/// A video that plays while its page is shown.
private struct VideoPage: View {
    var url: URL
    var poster: URL
    var active: Bool

    @State private var player: AVPlayer?

    var body: some View {
        ZStack {
            RemoteImage(thumbnail: poster, contentMode: .fit)
            if let player {
                VideoPlayer(player: player)
            }
        }
        .onAppear(perform: update)
        .onChange(of: active) { update() }
        .onDisappear {
            player?.pause()
            player = nil
        }
    }

    private func update() {
        if active {
            if player == nil {
                // The unlock cookie of password links has to go along explicitly.
                let cookies = HTTPCookieStorage.shared.cookies(for: url) ?? []
                let asset = AVURLAsset(url: url, options: [AVURLAssetHTTPCookiesKey: cookies])
                player = AVPlayer(playerItem: AVPlayerItem(asset: asset))
            }
            player?.play()
        } else {
            player?.pause()
        }
    }
}

/// A photo in a scroll view: pinch or double-tap to zoom, single tap toggles the bars.
private struct ZoomableImage: UIViewRepresentable {
    var thumbnail: URL
    var full: URL
    var onTap: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> UIScrollView {
        let scrollView = UIScrollView()
        scrollView.delegate = context.coordinator
        scrollView.minimumZoomScale = 1
        scrollView.maximumZoomScale = 4
        scrollView.showsHorizontalScrollIndicator = false
        scrollView.showsVerticalScrollIndicator = false
        scrollView.contentInsetAdjustmentBehavior = .never
        scrollView.backgroundColor = .clear

        let imageView = context.coordinator.imageView
        imageView.contentMode = .scaleAspectFit
        imageView.frame = scrollView.bounds
        imageView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        scrollView.addSubview(imageView)

        let doubleTap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.doubleTapped(_:)))
        doubleTap.numberOfTapsRequired = 2
        scrollView.addGestureRecognizer(doubleTap)
        let singleTap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.singleTapped))
        singleTap.require(toFail: doubleTap)
        scrollView.addGestureRecognizer(singleTap)

        context.coordinator.load(thumbnail: thumbnail, full: full)
        return scrollView
    }

    func updateUIView(_ scrollView: UIScrollView, context: Context) {
        context.coordinator.onTap = onTap
    }

    static func dismantleUIView(_ scrollView: UIScrollView, coordinator: Coordinator) {
        coordinator.task?.cancel()
    }

    final class Coordinator: NSObject, UIScrollViewDelegate {
        let imageView = UIImageView()
        var onTap: () -> Void = {}
        var task: Task<Void, Never>?

        func load(thumbnail: URL, full: URL) {
            let pipeline = ImagePipeline.shared
            if let sharp = pipeline.cached(full) {
                imageView.image = sharp
                return
            }
            let imageView = self.imageView
            imageView.image = pipeline.cached(thumbnail)
            task = Task { @MainActor in
                if imageView.image == nil, let small = try? await pipeline.image(thumbnail) {
                    imageView.image = small
                }
                if let sharp = try? await pipeline.image(full) {
                    imageView.image = sharp
                }
            }
        }

        func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }

        @objc func singleTapped() { onTap() }

        @objc func doubleTapped(_ gesture: UITapGestureRecognizer) {
            guard let scrollView = gesture.view as? UIScrollView else { return }
            if scrollView.zoomScale > 1 {
                scrollView.setZoomScale(1, animated: true)
            } else {
                let point = gesture.location(in: imageView)
                let size = CGSize(width: scrollView.bounds.width / 2.5, height: scrollView.bounds.height / 2.5)
                scrollView.zoom(to: CGRect(x: point.x - size.width / 2, y: point.y - size.height / 2, width: size.width, height: size.height), animated: true)
            }
        }
    }
}
