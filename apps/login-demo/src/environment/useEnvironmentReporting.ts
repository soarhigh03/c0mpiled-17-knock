import { useCallback, useEffect } from 'react'
import type { KnockClient } from '../knock/types.ts'
import { normalizeLabel, toEnvironmentEvidence } from './evidence.ts'
import type { NativeEnvironment } from './types.ts'
import { useStreamBinding, type DeviceMismatch, type StreamBinding } from './useStreamBinding.ts'

const label = (track: MediaStreamTrack | undefined) => (track ? normalizeLabel(track.label) : null)

/**
 * Binds the stream to the native device list and reports the environment to the
 * client: once when the stream is bound, and again (with `change`) whenever the
 * stream moves to another device mid-call.
 */
export function useEnvironmentReporting(
  client: KnockClient,
  stream: MediaStream | null,
  env: NativeEnvironment | null,
): StreamBinding {
  const report = useCallback(
    async (change?: DeviceMismatch) => {
      const devices = await navigator.mediaDevices.enumerateDevices()
      client.reportEnvironment({
        evidence: toEnvironmentEvidence({
          devices,
          env,
          isFullscreen: document.fullscreenElement != null,
          userAgent: navigator.userAgent,
        }),
        activeCamera: label(stream?.getVideoTracks()[0]),
        activeMicrophone: label(stream?.getAudioTracks()[0]),
        change: change && { ...change, from: normalizeLabel(change.from), to: normalizeLabel(change.to) },
      })
    },
    [client, env, stream],
  )
  const binding = useStreamBinding(stream, env, (mismatch) => void report(mismatch))
  useEffect(() => {
    if (binding.cameraLabel) void report()
  }, [binding.cameraLabel, report])
  return binding
}
