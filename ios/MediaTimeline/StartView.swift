import MediaTimelineKit
import SwiftUI

/// What the navigation stack shows: a timeline, optionally scrolled to a photo.
struct OpenTimeline: Hashable {
    var source: TimelineSource
    var photoId: String?
}

/// The list of opened timelines and the field to add a link.
struct StartView: View {
    @State private var links: [SavedLink] = []
    @State private var path: [OpenTimeline] = []
    @State private var input = ""
    @State private var inputError: String?
    @FocusState private var inputFocused: Bool

    private let store = SavedLinkStore()

    var body: some View {
        NavigationStack(path: $path) {
            List {
                Section {
                    TextField("https://…/t/…", text: $input)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($inputFocused)
                        .submitLabel(.go)
                        .onSubmit { open(input) }
                        .accessibilityIdentifier("linkField")
                    HStack {
                        PasteButton(payloadType: String.self) { strings in
                            if let text = strings.first { Task { @MainActor in open(text) } }
                        }
                        .labelStyle(.titleAndIcon)
                        .buttonBorderShape(.capsule)
                        Spacer()
                        Button("Öffnen") { open(input) }
                            .buttonStyle(.borderedProminent)
                            .disabled(input.trimmingCharacters(in: .whitespaces).isEmpty)
                            .accessibilityIdentifier("openLink")
                    }
                    if let inputError {
                        Text(inputError).font(.footnote).foregroundStyle(.red)
                    }
                } header: {
                    Text("Link öffnen")
                } footer: {
                    Text("Füge einen Link zu einer geteilten Timeline ein, z. B. aus einer Nachricht.")
                }

                if !links.isEmpty {
                    Section("Zuletzt geöffnet") {
                        ForEach(links) { link in
                            NavigationLink(value: OpenTimeline(source: link.source)) {
                                SavedLinkRow(link: link)
                            }
                        }
                        .onDelete { offsets in
                            let ids = offsets.map { links[$0].id }
                            for id in ids { links = store.remove(id) }
                        }
                    }
                }

                Section {
                    Button {
                        path.append(OpenTimeline(source: .projectDemo))
                    } label: {
                        Label("Demo ansehen", systemImage: "sparkles")
                    }
                    .accessibilityIdentifier("openDemo")
                } footer: {
                    Text("Eine Beispielreise mit freien Fotos von Wikimedia Commons.\nmediatimeline v\(AppInfo.version)")
                }
            }
            .navigationTitle("mediatimeline")
            .navigationDestination(for: OpenTimeline.self) { open in
                TimelineScreen(source: open.source, photoId: open.photoId) { saved in
                    links = store.upsert(saved)
                }
            }
            .onAppear { links = store.load() }
        }
        .tint(Color(accent: Accent.of(nil)))
        .onOpenURL { url in open(url.absoluteString) }
    }

    private func open(_ text: String) {
        guard let link = ParsedLink.parse(text) else {
            inputError = "Das ist kein Link zu einer Timeline. Er sieht so aus: https://…/t/…"
            return
        }
        inputError = nil
        input = ""
        inputFocused = false
        path = [OpenTimeline(source: link.source, photoId: link.photoId)]
    }
}

private struct SavedLinkRow: View {
    var link: SavedLink

    var body: some View {
        HStack(spacing: 12) {
            Group {
                if let cover = link.coverAssetId {
                    RemoteImage(thumbnail: link.source.mediaURL(cover, .thumbnail))
                } else {
                    Image(systemName: "photo.on.rectangle.angled")
                        .font(.title2)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(.quaternary)
                }
            }
            .frame(width: 56, height: 56)
            .clipShape(RoundedRectangle(cornerRadius: 10))

            VStack(alignment: .leading, spacing: 2) {
                Text(link.title ?? "Timeline").font(.headline).lineLimit(2)
                if let range = link.dateRange {
                    Text(range).font(.subheadline).foregroundStyle(.secondary)
                }
                Text(link.source.host).font(.caption).foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 2)
    }
}
