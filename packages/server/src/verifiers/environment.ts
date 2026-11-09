import type { CheckResult, EnvironmentEvidence } from '@knock/shared'

// Label heuristics are trivially bypassable by renaming; treat as a first filter only.
const VIRTUAL_DEVICE_PATTERNS = [
  /obs/i,
  /virtual/i,
  /snap\s*camera/i,
  /manycam/i,
  /xsplit/i,
  /mmhmm/i,
  /camo/i,
  /droidcam/i,
  /e2esoft|vcam/i,
  /blackhole/i,
  /vb-?audio|voicemeeter/i,
  /loopback/i,
]

export function verifyEnvironment(ev: EnvironmentEvidence): CheckResult {
  const reasons: string[] = []
  const devices = [...ev.videoInputs, ...ev.audioInputs]
  const virtual = devices.filter((d) => VIRTUAL_DEVICE_PATTERNS.some((p) => p.test(d.label)))

  if (virtual.length > 0) reasons.push(`virtual device detected: ${virtual.map((d) => d.label).join(', ')}`)
  if (!ev.isFullscreen) reasons.push('not in fullscreen')
  if (ev.focusLostCount > 0) reasons.push(`window lost focus ${ev.focusLostCount} time(s)`)
  if ((ev.screenCount ?? 1) > 1) reasons.push(`${ev.screenCount} screens attached`)

  // TODO: inspect the *selected* track's device, not just the list; add native checks in a desktop shell.
  const score = virtual.length > 0 ? 0 : Math.max(0, 1 - 0.2 * (reasons.length))
  return {
    kind: 'environment',
    status: virtual.length > 0 ? 'fail' : reasons.length > 0 ? 'inconclusive' : 'pass',
    score,
    reasons,
  }
}
