import Foundation
import Testing
@testable import Espada

@Suite(.serialized)
struct EspadaConfigFileTests {
    @Test
    func configPathRespectsEnvOverride() async {
        let override = FileManager().temporaryDirectory
            .appendingPathComponent("espada-config-\(UUID().uuidString)")
            .appendingPathComponent("espada.json")
            .path

        await TestIsolation.withEnvValues(["ESPADA_CONFIG_PATH": override]) {
            #expect(EspadaConfigFile.url().path == override)
        }
    }

    @MainActor
    @Test
    func remoteGatewayPortParsesAndMatchesHost() async {
        let override = FileManager().temporaryDirectory
            .appendingPathComponent("espada-config-\(UUID().uuidString)")
            .appendingPathComponent("espada.json")
            .path

        await TestIsolation.withEnvValues(["ESPADA_CONFIG_PATH": override]) {
            EspadaConfigFile.saveDict([
                "gateway": [
                    "remote": [
                        "url": "ws://gateway.ts.net:19999",
                    ],
                ],
            ])
            #expect(EspadaConfigFile.remoteGatewayPort() == 19999)
            #expect(EspadaConfigFile.remoteGatewayPort(matchingHost: "gateway.ts.net") == 19999)
            #expect(EspadaConfigFile.remoteGatewayPort(matchingHost: "gateway") == 19999)
            #expect(EspadaConfigFile.remoteGatewayPort(matchingHost: "other.ts.net") == nil)
        }
    }

    @MainActor
    @Test
    func setRemoteGatewayUrlPreservesScheme() async {
        let override = FileManager().temporaryDirectory
            .appendingPathComponent("espada-config-\(UUID().uuidString)")
            .appendingPathComponent("espada.json")
            .path

        await TestIsolation.withEnvValues(["ESPADA_CONFIG_PATH": override]) {
            EspadaConfigFile.saveDict([
                "gateway": [
                    "remote": [
                        "url": "wss://old-host:111",
                    ],
                ],
            ])
            EspadaConfigFile.setRemoteGatewayUrl(host: "new-host", port: 2222)
            let root = EspadaConfigFile.loadDict()
            let url = ((root["gateway"] as? [String: Any])?["remote"] as? [String: Any])?["url"] as? String
            #expect(url == "wss://new-host:2222")
        }
    }

    @Test
    func stateDirOverrideSetsConfigPath() async {
        let dir = FileManager().temporaryDirectory
            .appendingPathComponent("espada-state-\(UUID().uuidString)", isDirectory: true)
            .path

        await TestIsolation.withEnvValues([
            "ESPADA_CONFIG_PATH": nil,
            "ESPADA_STATE_DIR": dir,
        ]) {
            #expect(EspadaConfigFile.stateDirURL().path == dir)
            #expect(EspadaConfigFile.url().path == "\(dir)/espada.json")
        }
    }
}
