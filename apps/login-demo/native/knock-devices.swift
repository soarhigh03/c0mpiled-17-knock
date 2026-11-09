// Lists capture devices with the fields Knock uses to tell physical from virtual devices.
// Prints one JSON object to stdout: { "cameras": [...], "microphones": [...] }.
import AVFoundation
import Foundation

/// CoreMediaIO / CoreAudio transport types are FourCC codes ('bltn', 'usb ', 'virt', ...).
func fourCC(_ value: Int32) -> String {
    let n = UInt32(bitPattern: value)
    let bytes = [24, 16, 8, 0].map { UInt8((n >> UInt32($0)) & 0xFF) }
    if bytes.allSatisfy({ $0 >= 0x20 && $0 < 0x7F }) {
        return String(bytes: bytes, encoding: .ascii) ?? String(n)
    }
    return String(n)
}

func describe(_ d: AVCaptureDevice) -> [String: Any] {
    return [
        "name": d.localizedName,
        "uniqueID": d.uniqueID,
        "modelID": d.modelID,
        "manufacturer": d.manufacturer,
        "deviceType": d.deviceType.rawValue,
        "transportType": fourCC(d.transportType),
        "isConnected": d.isConnected,
        "isSuspended": d.isSuspended,
    ]
}

let cameras = AVCaptureDevice.DiscoverySession(
    deviceTypes: [.builtInWideAngleCamera, .external, .continuityCamera, .deskViewCamera],
    mediaType: .video,
    position: .unspecified
).devices

let microphones = AVCaptureDevice.DiscoverySession(
    deviceTypes: [.microphone, .external],
    mediaType: .audio,
    position: .unspecified
).devices

let out: [String: Any] = [
    "cameras": cameras.map(describe),
    "microphones": microphones.map(describe),
]
let data = try JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys])
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write("\n".data(using: .utf8)!)
