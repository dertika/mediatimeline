import MediaTimelineKit
import SwiftUI

/// Loads a timeline and shows it, the password form or what went wrong.
struct TimelineScreen: View {
    var source: TimelineSource
    var photoId: String?
    /// Called after loading, to update the list of saved links.
    var onLoad: (SavedLink) -> Void

    private enum Phase {
        case loading
        case loaded(Timeline)
        case password(title: String?)
        case failed(TimelineError)
    }

    @State private var phase = Phase.loading
    private let api = TimelineAPI()

    var body: some View {
        Group {
            switch phase {
            case .loading:
                ProgressView("Lade Timeline …")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            case let .loaded(timeline):
                TimelineContentView(source: source, timeline: timeline, photoId: photoId) {
                    await load()
                }
            case let .password(title):
                PasswordView(title: title) { password in
                    try await api.unlock(source, password: password)
                    await load()
                }
            case let .failed(error):
                ContentUnavailableView {
                    Label("Timeline nicht verfügbar", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(error.message)
                } actions: {
                    Button("Erneut versuchen") {
                        phase = .loading
                        Task { await load() }
                    }
                    .buttonStyle(.bordered)
                }
            }
        }
        .task {
            // Only the first time: the view also reappears after the fullscreen gallery.
            if case .loading = phase { await load() }
        }
    }

    private func load() async {
        do {
            let timeline = try await api.timeline(source)
            phase = .loaded(timeline)
            onLoad(SavedLink(
                source: source,
                title: timeline.title,
                dateRange: TimelineFormat.range(timeline.startDate, timeline.endDate),
                coverAssetId: timeline.assets.first?.id
            ))
        } catch let error as TimelineError {
            if case let .passwordRequired(title) = error {
                phase = .password(title: title)
                onLoad(SavedLink(source: source, title: title))
            } else if case .loaded = phase, case .network = error {
                // Pull to refresh offline: keep showing what we have.
            } else {
                phase = .failed(error)
            }
        } catch {
            phase = .failed(.network(error.localizedDescription))
        }
    }
}

/// Asks for the password of a protected link.
struct PasswordView: View {
    var title: String?
    var unlock: (String) async throws -> Void

    @State private var password = ""
    @State private var error: String?
    @State private var busy = false
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "lock.fill")
                .font(.system(size: 44))
                .foregroundStyle(.tint)
            VStack(spacing: 6) {
                Text(title ?? "Geschützte Timeline").font(.title2.bold()).multilineTextAlignment(.center)
                Text("Diese Timeline ist mit einem Passwort geschützt.")
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            SecureField("Passwort", text: $password)
                .textContentType(.password)
                .padding(12)
                .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
                .focused($focused)
                .submitLabel(.go)
                .onSubmit(submit)
                .accessibilityIdentifier("passwordField")
            if let error {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
            Button(action: submit) {
                Group {
                    if busy { ProgressView() } else { Text("Öffnen") }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(password.isEmpty || busy)
            .accessibilityIdentifier("unlock")
        }
        .padding(24)
        .frame(maxWidth: 420)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear { focused = true }
    }

    private func submit() {
        guard !password.isEmpty, !busy else { return }
        busy = true
        error = nil
        Task {
            do {
                try await unlock(password)
            } catch let failure as TimelineError {
                error = failure.message
            } catch {
                self.error = error.localizedDescription
            }
            busy = false
        }
    }
}
