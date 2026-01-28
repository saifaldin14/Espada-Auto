import Foundation

public enum EspadaLocationMode: String, Codable, Sendable, CaseIterable {
    case off
    case whileUsing
    case always
}
