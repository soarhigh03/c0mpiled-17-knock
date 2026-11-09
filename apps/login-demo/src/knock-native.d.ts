import type { EnvironmentChangeReason, NativeEnvironment } from './environment/types.ts'

export interface VoiceWindowResult {
  label: 'review' | 'pass' | 'unable'
  modelScore: number | null
  reason: string | null
  latencyMs: number
}

export interface SPCameraDevice {
  _name: string
  [key: string]: unknown
}

export interface SPCameraDataTypeResult {
  SPCameraDataType?: SPCameraDevice[]
}

/** Bridge from apps/login-demo/electron/preload.ts. */
export interface KnockNative {
  getVoiceAvailability: () => Promise<boolean>
  onVoiceAvailabilityChanged: (cb: (available: boolean) => void) => () => void
  analyzeVoiceWindow: (pcm16: ArrayBuffer) => Promise<VoiceWindowResult>
  listVideoDevices: () => Promise<SPCameraDataTypeResult>
  getEnvironment: () => Promise<NativeEnvironment>
  onEnvironmentChanged: (cb: (env: NativeEnvironment, reason: EnvironmentChangeReason) => void) => () => void
  /** What the window reports via BrowserWindow.isContentProtected(). */
  getContentProtection: () => Promise<boolean>
  onContentProtectionChanged: (cb: (enabled: boolean) => void) => () => void
}

declare global {
  interface Window {
    /** Present only inside the Electron shell. */
    knockNative?: KnockNative
  }
}
