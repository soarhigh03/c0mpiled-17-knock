import type { EnvironmentChangeReason, NativeEnvironment } from './environment/types.ts'

export interface SPCameraDevice {
  _name: string
  [key: string]: unknown
}

export interface SPCameraDataTypeResult {
  SPCameraDataType?: SPCameraDevice[]
}

/** Bridge from apps/login-demo/electron/preload.ts. */
export interface KnockNative {
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
