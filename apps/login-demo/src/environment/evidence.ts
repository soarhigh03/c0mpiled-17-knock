import type { EnvironmentEvidence } from '@knock/shared'
import type { NativeDevice, NativeEnvironment } from './types.ts'

/** Minimal MediaDeviceInfo shape, so this stays testable outside the browser. */
export interface MediaDeviceLike {
  kind: string
  label: string
  deviceId: string
}

/**
 * Browser labels use the same localized device names, but Chromium on macOS
 * appends "(vid:pid)" to cameras, e.g. "‘MacBook Pro’ 카메라 (0000:0001)", a
 * transport to microphones, e.g. "MacBook Pro 마이크 (Built-in)", and prefixes
 * the default input with "Default - ".
 */
const TRANSPORT_SUFFIX =
  /\s*\((Built-in|USB|Bluetooth|Virtual|Aggregate|Thunderbolt|HDMI|DisplayPort|AirPlay|PCI|FireWire|AVB|Unknown)\)\s*$/i

export function normalizeLabel(label: string): string {
  return label
    .replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '')
    .replace(TRANSPORT_SUFFIX, '')
    .replace(/^(default|기본값?)\s*-\s*/i, '')
    .trim()
}

export function matchNativeDevice(label: string, devices: readonly NativeDevice[]): NativeDevice | null {
  const wanted = normalizeLabel(label)
  if (!wanted) return null
  return devices.find((d) => normalizeLabel(d.name) === wanted) ?? null
}

/** Packages the environment in the @knock/shared EnvironmentEvidence shape. */
export function toEnvironmentEvidence(input: {
  devices: readonly MediaDeviceLike[]
  env: NativeEnvironment | null
  isFullscreen: boolean
  userAgent: string
}): EnvironmentEvidence {
  const pick = (kind: string) =>
    input.devices
      .filter((d) => d.kind === kind && d.deviceId !== 'default')
      .map((d) => ({ label: d.label, deviceId: d.deviceId }))
  return {
    kind: 'environment',
    videoInputs: pick('videoinput'),
    audioInputs: pick('audioinput'),
    screenCount: input.env?.displays.length,
    isFullscreen: input.isFullscreen,
    focusLostCount: input.env?.focus.blurCount ?? 0,
    userAgent: input.userAgent,
  }
}
