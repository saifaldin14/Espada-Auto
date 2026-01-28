import Foundation

public enum EspadaCapability: String, Codable, Sendable {
    case canvas
    case camera
    case screen
    case voiceWake
    case location
}
