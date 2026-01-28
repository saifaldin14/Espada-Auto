import Foundation

public enum EspadaCameraCommand: String, Codable, Sendable {
    case list = "camera.list"
    case snap = "camera.snap"
    case clip = "camera.clip"
}

public enum EspadaCameraFacing: String, Codable, Sendable {
    case back
    case front
}

public enum EspadaCameraImageFormat: String, Codable, Sendable {
    case jpg
    case jpeg
}

public enum EspadaCameraVideoFormat: String, Codable, Sendable {
    case mp4
}

public struct EspadaCameraSnapParams: Codable, Sendable, Equatable {
    public var facing: EspadaCameraFacing?
    public var maxWidth: Int?
    public var quality: Double?
    public var format: EspadaCameraImageFormat?
    public var deviceId: String?
    public var delayMs: Int?

    public init(
        facing: EspadaCameraFacing? = nil,
        maxWidth: Int? = nil,
        quality: Double? = nil,
        format: EspadaCameraImageFormat? = nil,
        deviceId: String? = nil,
        delayMs: Int? = nil)
    {
        self.facing = facing
        self.maxWidth = maxWidth
        self.quality = quality
        self.format = format
        self.deviceId = deviceId
        self.delayMs = delayMs
    }
}

public struct EspadaCameraClipParams: Codable, Sendable, Equatable {
    public var facing: EspadaCameraFacing?
    public var durationMs: Int?
    public var includeAudio: Bool?
    public var format: EspadaCameraVideoFormat?
    public var deviceId: String?

    public init(
        facing: EspadaCameraFacing? = nil,
        durationMs: Int? = nil,
        includeAudio: Bool? = nil,
        format: EspadaCameraVideoFormat? = nil,
        deviceId: String? = nil)
    {
        self.facing = facing
        self.durationMs = durationMs
        self.includeAudio = includeAudio
        self.format = format
        self.deviceId = deviceId
    }
}
