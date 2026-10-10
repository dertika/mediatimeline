import MediaTimelineKit
import SwiftUI

/// A photo or video of the timeline with caption, time, place and comments.
struct AssetRow: View {
    var asset: TimelineAsset
    var source: TimelineSource
    var comments: [TimelineComment]
    var isNew: Bool
    var accent: Accent
    var open: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button(action: open) {
                Color.clear
                    .aspectRatio(CGFloat(asset.aspectRatio ?? 4 / 3), contentMode: .fit)
                    .overlay {
                        RemoteImage(
                            thumbnail: source.mediaURL(asset.id, .thumbnail),
                            full: source.mediaURL(asset.id, .preview)
                        )
                    }
                    .overlay {
                        if asset.type == .video {
                            Image(systemName: "play.fill")
                                .font(.title)
                                .foregroundStyle(.white)
                                .frame(width: 64, height: 64)
                                .background(.black.opacity(0.45), in: Circle())
                        }
                    }
                    .overlay(alignment: .topLeading) {
                        if isNew {
                            Text("Neu")
                                .font(.caption.bold())
                                .foregroundStyle(Color(onAccent: accent))
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(Color(accent: accent), in: Capsule())
                                .padding(8)
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .contentShape(RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(asset.caption ?? (asset.type == .video ? "Video" : "Foto"))
            .accessibilityIdentifier("asset-\(asset.id)")

            if let caption = asset.caption {
                Text(caption)
            }
            HStack(alignment: .firstTextBaseline) {
                Text([TimelineFormat.time(asset.localDateTime), asset.place].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Spacer()
                ShareLink(item: source.photoURL(asset.id)) {
                    Image(systemName: "square.and.arrow.up")
                        .font(.footnote)
                }
                .accessibilityLabel("Link zu diesem Foto teilen")
            }
            if !comments.isEmpty {
                CommentList(comments: comments, label: "Kommentare")
            }
        }
    }
}

/// Comments as bubbles; more than three are folded.
struct CommentList: View {
    var comments: [TimelineComment]
    var label: String

    @State private var expanded = false

    var body: some View {
        if comments.count > 3 && !expanded {
            Button {
                withAnimation { expanded = true }
            } label: {
                Label("\(comments.count) \(label)", systemImage: "bubble.left.and.bubble.right")
                    .font(.footnote)
            }
        } else {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(Array(comments.enumerated()), id: \.offset) { _, comment in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(comment.text)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(.quaternary, in: RoundedRectangle(cornerRadius: 14))
                        Text(byline(comment))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .padding(.leading, 12)
                    }
                }
            }
        }
    }

    private func byline(_ comment: TimelineComment) -> String {
        guard let date = TimelineFormat.parse(comment.createdAt) else { return comment.author }
        // A real instant: shown in the phone's time zone.
        return "\(comment.author) · \(date.formatted(.dateTime.day().month().year().hour().minute().locale(Locale(identifier: "de_DE"))))"
    }
}
