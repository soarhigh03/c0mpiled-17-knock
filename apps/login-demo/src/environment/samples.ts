import type { DeviceKind, DeviceVerdict, RawCaptureDevice } from './types.ts'

export interface DeviceSample {
  /** Where the raw fields came from. */
  source: string
  kind: DeviceKind
  raw: RawCaptureDevice
  expected: DeviceVerdict
}

/**
 * Inputs for classify.test.ts. "probe" rows are copied verbatim from
 * native/knock-devices output on a MacBook Pro (macOS 27.2, Korean locale);
 * "synthetic" rows cover rule branches that machine had no device for.
 */
export const DEVICE_SAMPLES: DeviceSample[] = [
  {
    source: 'probe: built-in camera',
    kind: 'camera',
    raw: {
      name: '‘MacBook Pro’ 카메라',
      uniqueID: '6C707041-05AC-0010-0001-000000000001',
      modelID: '‘MacBook Pro’ 카메라',
      manufacturer: 'Apple Inc.',
      deviceType: 'AVCaptureDeviceTypeBuiltInWideAngleCamera',
      transportType: 'bltn',
      isConnected: true,
      isSuspended: false,
    },
    expected: 'allowed',
  },
  {
    source: 'probe: Desk View camera',
    kind: 'camera',
    raw: {
      name: '‘MacBook Pro’ 데스크뷰 카메라',
      uniqueID: '6C707041-05AC-0010-0001-000000000002',
      modelID: '‘MacBook Pro’ 데스크뷰 카메라',
      manufacturer: 'Apple Inc.',
      deviceType: 'AVCaptureDeviceTypeDeskViewCamera',
      transportType: 'bltn',
      isConnected: true,
      isSuspended: false,
    },
    expected: 'review',
  },
  {
    source: 'probe: built-in microphone',
    kind: 'microphone',
    raw: {
      name: 'MacBook Pro 마이크',
      uniqueID: 'BuiltInMicrophoneDevice',
      modelID: 'Digital Mic',
      manufacturer: 'Apple Inc.',
      deviceType: 'AVCaptureDeviceTypeMicrophone',
      transportType: 'bltn',
      isConnected: true,
      isSuspended: false,
    },
    expected: 'allowed',
  },
  {
    source: 'probe: OBS Virtual Camera (OBS 33, camera extension)',
    kind: 'camera',
    raw: {
      name: 'OBS Virtual Camera',
      uniqueID: '7626645E-4425-469E-9D8B-97E0FA59AC75',
      modelID: 'OBS Camera Extension',
      manufacturer: 'OBS Project',
      deviceType: 'AVCaptureDeviceTypeExternal',
      transportType: 'virt',
      isConnected: true,
      isSuspended: false,
    },
    expected: 'blocked',
  },
  {
    source: 'system_profiler fallback: OBS Virtual Camera (name only)',
    kind: 'camera',
    raw: {
      name: 'OBS Virtual Camera',
      uniqueID: '7626645E-4425-469E-9D8B-97E0FA59AC75',
      modelID: 'OBS Camera Extension',
      manufacturer: '',
      deviceType: '',
      transportType: '',
    },
    expected: 'blocked',
  },
  {
    source: 'system_profiler fallback: built-in camera (no transport)',
    kind: 'camera',
    raw: {
      name: '‘MacBook Pro’ 카메라',
      uniqueID: '6C707041-05AC-0010-0001-000000000001',
      modelID: '‘MacBook Pro’ 카메라',
      manufacturer: '',
      deviceType: '',
      transportType: '',
    },
    expected: 'review',
  },
  {
    source: 'synthetic: USB webcam',
    kind: 'camera',
    raw: {
      name: 'HD Pro Webcam C920',
      uniqueID: '0x1420000046d082d',
      modelID: 'UVC Camera VendorID_1133 ProductID_2141',
      manufacturer: 'Unknown',
      deviceType: 'AVCaptureDeviceTypeExternal',
      transportType: 'usb ',
    },
    expected: 'allowed',
  },
  {
    source: 'synthetic: renamed device on a virtual transport',
    kind: 'camera',
    raw: {
      name: 'FaceTime HD Camera',
      uniqueID: 'renamed-1',
      modelID: 'FaceTime HD Camera',
      manufacturer: 'Apple Inc.',
      deviceType: 'AVCaptureDeviceTypeExternal',
      transportType: 'virt',
    },
    expected: 'blocked',
  },
  {
    source: 'synthetic: Bluetooth headset microphone',
    kind: 'microphone',
    raw: {
      name: 'AirPods Pro',
      uniqueID: 'bt-1',
      modelID: 'AirPods Pro',
      manufacturer: 'Apple Inc.',
      deviceType: 'AVCaptureDeviceTypeMicrophone',
      transportType: 'blue',
    },
    expected: 'review',
  },
]
