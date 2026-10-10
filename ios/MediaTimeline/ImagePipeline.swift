import SwiftUI
import UIKit

/// Loads and decodes remote images once; decoded images stay in memory while
/// there is room. The HTTP cache (URLCache) keeps the files across launches,
/// and the shared cookie storage carries the unlock cookie of password links.
actor ImagePipeline {
    static let shared = ImagePipeline()

    private let memory = MemoryCache()
    private var running: [URL: Task<UIImage, Error>] = [:]

    nonisolated func cached(_ url: URL) -> UIImage? {
        memory.image(url)
    }

    func image(_ url: URL) async throws -> UIImage {
        if let image = memory.image(url) { return image }
        if let task = running[url] { return try await task.value }
        let task = Task<UIImage, Error> {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard (response as? HTTPURLResponse)?.statusCode == 200, let image = UIImage(data: data) else {
                throw URLError(.cannotDecodeContentData)
            }
            return await image.byPreparingForDisplay() ?? image
        }
        running[url] = task
        defer { running[url] = nil }
        let image = try await task.value
        memory.store(image, for: url)
        return image
    }

    /// Starts loading without waiting, e.g. the next photos of the gallery.
    nonisolated func prefetch(_ url: URL) {
        Task { _ = try? await self.image(url) }
    }
}

/// Decoded images by URL; NSCache is thread-safe.
private final class MemoryCache: @unchecked Sendable {
    private let cache: NSCache<NSURL, UIImage> = {
        let cache = NSCache<NSURL, UIImage>()
        cache.totalCostLimit = 200 << 20
        return cache
    }()

    func image(_ url: URL) -> UIImage? {
        cache.object(forKey: url as NSURL)
    }

    func store(_ image: UIImage, for url: URL) {
        let cost = Int(image.size.width * image.size.height * image.scale * image.scale * 4)
        cache.setObject(image, forKey: url as NSURL, cost: cost)
    }
}

/// A photo that shows the small thumbnail first and the sharp preview once it
/// stayed on screen for a moment (like the web app's progressive loading).
struct RemoteImage: View {
    var thumbnail: URL
    var full: URL?
    var contentMode: ContentMode = .fill

    @State private var image: UIImage?

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: contentMode)
            } else {
                Rectangle().fill(.quaternary)
            }
        }
        .task(id: thumbnail) {
            let pipeline = ImagePipeline.shared
            if let full, let sharp = pipeline.cached(full) {
                image = sharp
                return
            }
            if image == nil, let small = try? await pipeline.image(thumbnail) {
                image = small
            }
            guard let full else { return }
            // Scrolled past quickly: the task is cancelled before the preview loads.
            try? await Task.sleep(for: .milliseconds(150))
            guard !Task.isCancelled, let sharp = try? await pipeline.image(full) else { return }
            image = sharp
        }
    }
}
