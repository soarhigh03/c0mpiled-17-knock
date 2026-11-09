import type { EnvironmentEvidence } from '@knock/shared'

let focusLostCount = 0
let watching = false

const onBlur = () => focusLostCount++
const onVisibility = () => {
  if (document.visibilityState === 'hidden') focusLostCount++
}

/**
 * Start the count over. Called when a verification run begins so the evidence
 * covers that run: the watch is installed at page load and a long session
 * accumulates every alt-tab since, which says nothing about the moment we are
 * actually judging.
 */
export function resetFocusLoss(): void {
  focusLostCount = 0
}

export function startEnvironmentWatch(): () => void {
  if (!watching) {
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    watching = true
  }
  return () => {
    window.removeEventListener('blur', onBlur)
    document.removeEventListener('visibilitychange', onVisibility)
    watching = false
  }
}

async function countScreens(): Promise<number | undefined> {
  // Window Management API (Chromium). Requires permission; fall back silently.
  const w = window as Window & { getScreenDetails?: () => Promise<{ screens: unknown[] }> }
  if (!w.getScreenDetails) return (screen as Screen & { isExtended?: boolean }).isExtended ? 2 : undefined
  try {
    return (await w.getScreenDetails()).screens.length
  } catch {
    return undefined
  }
}

export async function collectEnvironment(): Promise<EnvironmentEvidence> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  const pick = (kind: MediaDeviceKind) =>
    devices.filter((d) => d.kind === kind).map((d) => ({ label: d.label, deviceId: d.deviceId }))

  return {
    kind: 'environment',
    videoInputs: pick('videoinput'),
    audioInputs: pick('audioinput'),
    screenCount: await countScreens(),
    isFullscreen: document.fullscreenElement != null,
    focusLostCount,
    userAgent: navigator.userAgent,
  }
}
