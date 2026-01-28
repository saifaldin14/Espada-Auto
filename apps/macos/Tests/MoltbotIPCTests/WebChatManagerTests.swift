import Testing
@testable import Espada

@Suite(.serialized)
@MainActor
struct WebChatManagerTests {
    @Test func preferredSessionKeyIsNonEmpty() async {
        let key = await WebChatManager.shared.preferredSessionKey()
        #expect(!key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }
}
