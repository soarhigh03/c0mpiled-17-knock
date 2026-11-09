import { useEffect, useState } from 'react'
import type { NativeEnvironment } from './types.ts'

/** Latest native environment from the Electron main process; null in a plain browser or until loaded. */
export function useNativeEnvironment(): NativeEnvironment | null {
  const [env, setEnv] = useState<NativeEnvironment | null>(null)
  useEffect(() => {
    const native = window.knockNative
    if (!native) return
    let cancelled = false
    native
      .getEnvironment()
      .then((e) => {
        if (!cancelled) setEnv(e)
      })
      .catch((err: unknown) => console.warn('[knock] getEnvironment failed', err))
    const off = native.onEnvironmentChanged((e) => setEnv(e))
    return () => {
      cancelled = true
      off()
    }
  }, [])
  return env
}

/**
 * Whether this window is actually excluded from screen capture, as reported
 * by the main process. Always false outside Electron.
 */
export function useContentProtection(): boolean {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    const native = window.knockNative
    if (!native) return
    let cancelled = false
    native
      .getContentProtection()
      .then((on) => {
        if (!cancelled) setEnabled(on)
      })
      .catch(() => {})
    const off = native.onContentProtectionChanged(setEnabled)
    return () => {
      cancelled = true
      off()
    }
  }, [])
  return enabled
}
