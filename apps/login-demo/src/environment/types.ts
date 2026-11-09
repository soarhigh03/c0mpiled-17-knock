/** Shared between the Electron main process, the preload bridge and the renderer. */

export type DeviceKind = 'camera' | 'microphone'

export type DeviceVerdict = 'allowed' | 'blocked' | 'review'

/**
 * One capture device as reported by native/knock-devices.swift (AVCaptureDevice).
 * transportType is a CoreMediaIO/CoreAudio FourCC such as 'bltn', 'usb ' or 'virt'.
 * When the Swift probe is unavailable, the system_profiler fallback leaves
 * deviceType/transportType empty.
 */
export interface RawCaptureDevice {
  name: string
  uniqueID: string
  modelID: string
  manufacturer: string
  deviceType: string
  transportType: string
  isConnected?: boolean
  isSuspended?: boolean
}

export interface Classification {
  verdict: DeviceVerdict
  reason: string
}

export interface NativeDevice {
  kind: DeviceKind
  name: string
  raw: RawCaptureDevice
  classification: Classification
}

export interface DisplayInfo {
  id: number
  label: string
  internal: boolean
  width: number
  height: number
  scaleFactor: number
}

export interface SuspiciousProcess {
  app: string
  path: string
}

export interface FocusStats {
  blurCount: number
  totalBlurMs: number
  lastBlurMs: number | null
}

export interface NativeEnvironment {
  /** Where device data came from; 'system_profiler' means the Swift probe was unavailable. */
  source: 'avfoundation' | 'system_profiler'
  cameras: NativeDevice[]
  microphones: NativeDevice[]
  displays: DisplayInfo[]
  suspiciousProcesses: SuspiciousProcess[]
  windowFocused: boolean
  focus: FocusStats
  collectedAt: number
}

export type EnvironmentChangeReason = 'devices' | 'displays' | 'processes' | 'focus'
