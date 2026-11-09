export interface SPCameraDevice {
  _name: string
  [key: string]: unknown
}

export interface SPCameraDataTypeResult {
  SPCameraDataType?: SPCameraDevice[]
}

declare global {
  interface Window {
    /** Present only inside the Electron shell (apps/meet/electron/preload.ts). */
    knockNative?: {
      listVideoDevices: () => Promise<SPCameraDataTypeResult>
    }
  }
}
