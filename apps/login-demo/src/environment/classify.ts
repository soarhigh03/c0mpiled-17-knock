import type { Classification, DeviceKind, RawCaptureDevice } from './types.ts'

/**
 * Physical-vs-virtual device classification. Allowlist only: a device is
 * "allowed" when its transport and type say built-in or USB hardware. Names
 * never allow anything (they are trivially renamed); they can only block.
 * Anything not recognised is "review", never "allowed".
 */

/** AVCaptureDevice.transportType FourCCs (kIOAudioDeviceTransportType*). */
export const TRANSPORT = {
  builtIn: 'bltn',
  usb: 'usb ',
  virtual: 'virt',
  bluetooth: 'blue',
  bluetoothLE: 'blea',
} as const

/** Names, models or manufacturers of known virtual devices. */
export const VIRTUAL_DEVICE_PATTERNS: readonly RegExp[] = [
  /\bOBS\b/i,
  /obsproject/i,
  /ManyCam/i,
  /Snap Camera/i,
  /mmhmm/i,
  /CamTwist/i,
  /XSplit/i,
  /\bCamo\b/i,
  /Reincubate/i,
  /DeepFaceLive/i,
  /Deep-Live-Cam/i,
  /Voicemod/i,
  /Loopback/i,
  /Rogue Amoeba/i,
  /BlackHole/i,
  /Soundflower/i,
  /\bvirtual\b/i,
]

const CAMERA_TYPE = {
  builtIn: 'AVCaptureDeviceTypeBuiltInWideAngleCamera',
  external: 'AVCaptureDeviceTypeExternal',
  deskView: 'AVCaptureDeviceTypeDeskViewCamera',
  continuity: 'AVCaptureDeviceTypeContinuityCamera',
}
const MIC_TYPES = ['AVCaptureDeviceTypeMicrophone', 'AVCaptureDeviceTypeBuiltInMicrophone', 'AVCaptureDeviceTypeExternal']

const NOUN: Record<DeviceKind, string> = { camera: 'camera', microphone: 'microphone' }

function matchesVirtualName(d: RawCaptureDevice): string | null {
  for (const field of [d.name, d.modelID, d.manufacturer]) {
    if (field && VIRTUAL_DEVICE_PATTERNS.some((p) => p.test(field))) return field
  }
  return null
}

export function classifyDevice(kind: DeviceKind, d: RawCaptureDevice): Classification {
  const noun = NOUN[kind]

  if (d.transportType === TRANSPORT.virtual) {
    return { verdict: 'blocked', reason: `Virtual device (transport "${d.transportType}")` }
  }
  const virtualName = matchesVirtualName(d)
  if (virtualName) {
    return { verdict: 'blocked', reason: `Known virtual device: ${virtualName}` }
  }

  if (kind === 'camera') {
    if (d.deviceType === CAMERA_TYPE.deskView) {
      return { verdict: 'review', reason: 'Desk View shows the desk, not your face' }
    }
    if (d.transportType === TRANSPORT.builtIn && d.deviceType === CAMERA_TYPE.builtIn) {
      return { verdict: 'allowed', reason: 'Built-in camera' }
    }
    if (d.transportType === TRANSPORT.usb && d.deviceType === CAMERA_TYPE.external) {
      return { verdict: 'allowed', reason: 'USB camera' }
    }
    if (d.deviceType === CAMERA_TYPE.continuity) {
      return { verdict: 'review', reason: 'Continuity Camera is not on the allowlist' }
    }
  } else {
    const isMic = MIC_TYPES.includes(d.deviceType)
    if (isMic && d.transportType === TRANSPORT.builtIn) return { verdict: 'allowed', reason: 'Built-in microphone' }
    if (isMic && d.transportType === TRANSPORT.usb) return { verdict: 'allowed', reason: 'USB microphone' }
    if (d.transportType === TRANSPORT.bluetooth || d.transportType === TRANSPORT.bluetoothLE) {
      return { verdict: 'review', reason: 'Bluetooth microphone is not on the allowlist' }
    }
  }

  const transport = d.transportType.trim() || 'unknown'
  const type = d.deviceType.replace(/^AVCaptureDeviceType/, '') || 'unknown type'
  return { verdict: 'review', reason: `Unrecognised ${noun} (transport ${transport}, ${type})` }
}
