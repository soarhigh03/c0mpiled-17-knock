import type { SuspiciousProcess } from './types.ts'

/**
 * Apps that can inject a virtual camera or audio path. Matched against
 * `ps -axo comm=` lines, which on macOS are full executable paths.
 */
export const SUSPICIOUS_APPS: readonly { app: string; pattern: RegExp }[] = [
  // The OBS camera extension process outlives the app and can't be quit by the candidate,
  // so only the app itself counts here; the virtual camera is caught by device classification.
  { app: 'OBS Studio', pattern: /\/OBS\.app\/|(^|\/)obs$/i },
  { app: 'ManyCam', pattern: /manycam/i },
  { app: 'Snap Camera', pattern: /snap camera/i },
  { app: 'mmhmm', pattern: /mmhmm/i },
  { app: 'Camo', pattern: /\/Camo\.app\/|reincubate|(^|\/)Camo$/ },
  { app: 'CamTwist', pattern: /camtwist/i },
  { app: 'XSplit', pattern: /xsplit/i },
  { app: 'DeepFaceLive', pattern: /deepfacelive/i },
  { app: 'Deep-Live-Cam', pattern: /deep-live-cam/i },
  { app: 'Voicemod', pattern: /voicemod/i },
  { app: 'Loopback', pattern: /\/Loopback\.app\/|(^|\/)Loopback$/ },
]

/** One entry per app, in SUSPICIOUS_APPS order. */
export function matchSuspiciousProcesses(commLines: readonly string[]): SuspiciousProcess[] {
  const found: SuspiciousProcess[] = []
  for (const { app, pattern } of SUSPICIOUS_APPS) {
    const path = commLines.find((line) => pattern.test(line.trim()))
    if (path) found.push({ app, path: path.trim() })
  }
  return found
}

export function describeProcesses(processes: readonly SuspiciousProcess[]): string {
  const names = processes.map((p) => p.app)
  if (names.length === 0) return 'No virtual camera or audio apps running'
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `${list} ${names.length === 1 ? 'is' : 'are'} running — quit to continue`
}
