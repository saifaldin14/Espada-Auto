import Foundation

public enum EspadaChatTransportEvent: Sendable {
    case health(ok: Bool)
    case tick
    case chat(EspadaChatEventPayload)
    case agent(EspadaAgentEventPayload)
    case seqGap
}

public protocol EspadaChatTransport: Sendable {
    func requestHistory(sessionKey: String) async throws -> EspadaChatHistoryPayload
    func sendMessage(
        sessionKey: String,
        message: String,
        thinking: String,
        idempotencyKey: String,
        attachments: [EspadaChatAttachmentPayload]) async throws -> EspadaChatSendResponse

    func abortRun(sessionKey: String, runId: String) async throws
    func listSessions(limit: Int?) async throws -> EspadaChatSessionsListResponse

    func requestHealth(timeoutMs: Int) async throws -> Bool
    func events() -> AsyncStream<EspadaChatTransportEvent>

    func setActiveSessionKey(_ sessionKey: String) async throws
}

extension EspadaChatTransport {
    public func setActiveSessionKey(_: String) async throws {}

    public func abortRun(sessionKey _: String, runId _: String) async throws {
        throw NSError(
            domain: "EspadaChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "chat.abort not supported by this transport"])
    }

    public func listSessions(limit _: Int?) async throws -> EspadaChatSessionsListResponse {
        throw NSError(
            domain: "EspadaChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "sessions.list not supported by this transport"])
    }
}
