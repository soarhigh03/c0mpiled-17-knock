/**
 * Wording for BrowserWindow content protection. On macOS it sets
 * NSWindowSharingNone; apps that capture through ScreenCaptureKit can still
 * see the window, so the UI must not promise more than that.
 */
export const CAPTURE_PROTECTION_ON = 'capture protection on'
export const CAPTURE_PROTECTION_LIMIT =
  'This window is excluded from screen capture (NSWindowSharingNone). On macOS, apps that record through ScreenCaptureKit can still capture it.'
