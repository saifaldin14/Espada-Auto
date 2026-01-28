import EspadaChatUI
import EspadaKit
import SwiftUI

struct ChatSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var viewModel: EspadaChatViewModel
    private let userAccent: Color?

    init(gateway: GatewayNodeSession, sessionKey: String, userAccent: Color? = nil) {
        let transport = IOSGatewayChatTransport(gateway: gateway)
        self._viewModel = State(
            initialValue: EspadaChatViewModel(
                sessionKey: sessionKey,
                transport: transport))
        self.userAccent = userAccent
    }

    var body: some View {
        NavigationStack {
            EspadaChatView(
                viewModel: self.viewModel,
                showsSessionSwitcher: true,
                userAccent: self.userAccent)
                .navigationTitle("Chat")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            self.dismiss()
                        } label: {
                            Image(systemName: "xmark")
                        }
                        .accessibilityLabel("Close")
                    }
                }
        }
    }
}
