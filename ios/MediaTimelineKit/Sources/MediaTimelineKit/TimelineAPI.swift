import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Why a timeline could not be shown, with the German text for the user.
public enum TimelineError: Error, Equatable, Sendable {
    case notFound
    case expired
    /// The link has a password; `title` is the album title, if the server reveals it.
    case passwordRequired(title: String?)
    case wrongPassword
    case tooManyAttempts
    case server(status: Int)
    case invalidResponse
    case network(String)

    public var message: String {
        switch self {
        case .notFound: return "Diese Timeline gibt es nicht oder sie wurde deaktiviert."
        case .expired: return "Dieser Link ist abgelaufen."
        case .passwordRequired: return "Diese Timeline ist mit einem Passwort geschützt."
        case .wrongPassword: return "Das Passwort stimmt nicht."
        case .tooManyAttempts: return "Zu viele Versuche. Bitte später noch einmal probieren."
        case let .server(status): return "Der Server antwortet nicht wie erwartet (Fehler \(status))."
        case .invalidResponse: return "Die Antwort des Servers ist unverständlich. Ist das ein mediatimeline-Link?"
        case let .network(text): return "Keine Verbindung: \(text)"
        }
    }
}

/// Talks to the public API of a mediatimeline server. The unlock cookie of
/// password links is kept by the session's cookie storage and sent with the
/// media requests, too.
public struct TimelineAPI: Sendable {
    public var session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func timeline(_ source: TimelineSource) async throws -> Timeline {
        var request = URLRequest(url: source.timelineURL)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, status) = try await send(request)
        switch status {
        case 200:
            do {
                return try JSONDecoder().decode(Timeline.self, from: data)
            } catch {
                throw TimelineError.invalidResponse
            }
        case 401:
            let body = try? JSONDecoder().decode(ErrorBody.self, from: data)
            throw TimelineError.passwordRequired(title: body?.title)
        default:
            throw Self.error(status: status)
        }
    }

    /// Sends the password; on success the server sets the unlock cookie.
    public func unlock(_ source: TimelineSource, password: String) async throws {
        guard let url = source.unlockURL else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["password": password])
        let (_, status) = try await send(request)
        switch status {
        case 200: return
        case 401: throw TimelineError.wrongPassword
        default: throw Self.error(status: status)
        }
    }

    static func error(status: Int) -> TimelineError {
        switch status {
        case 404: return .notFound
        case 410: return .expired
        case 429: return .tooManyAttempts
        default: return .server(status: status)
        }
    }

    private func send(_ request: URLRequest) async throws -> (Data, Int) {
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw TimelineError.invalidResponse }
            return (data, http.statusCode)
        } catch let error as TimelineError {
            throw error
        } catch {
            throw TimelineError.network(error.localizedDescription)
        }
    }

    private struct ErrorBody: Decodable {
        var error: String?
        var title: String?
    }
}
