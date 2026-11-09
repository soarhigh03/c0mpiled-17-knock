import { AudioWaveform, ShieldCheck, Video, VideoOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { VideoView } from '../interviewer/VideoView.tsx'
import type { ChallengeRequest, KnockClient } from '../knock/types.ts'

interface ChallengeOverlayProps {
  challenge: ChallengeRequest
  client: KnockClient
  /** The call's camera + mic stream (self-view and audio recording). */
  stream: MediaStream | null
}

/** Near-ultrasonic carrier; inaudible for most adults. TODO(sonar): keyed pattern from the challenge. */
const SONAR_HZ = 19_500
const SONAR_GAIN = 0.08

function startTone(): { ready: Promise<boolean>; stop: () => void } {
  const ctx = new AudioContext()
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.frequency.value = SONAR_HZ
  // Fade in/out: an abrupt start or stop produces an audible click.
  gain.gain.setValueAtTime(0, ctx.currentTime)
  gain.gain.linearRampToValueAtTime(SONAR_GAIN, ctx.currentTime + 0.2)
  osc.connect(gain).connect(ctx.destination)
  osc.start()
  return {
    ready: ctx.resume().then(() => ctx.state === 'running'),
    stop: () => {
      const t = ctx.currentTime
      gain.gain.cancelScheduledValues(t)
      gain.gain.setValueAtTime(gain.gain.value, t)
      gain.gain.linearRampToValueAtTime(0, t + 0.2)
      osc.stop(t + 0.25)
      setTimeout(() => void ctx.close(), 400)
    },
  }
}

function startRecorder(stream: MediaStream | null) {
  const tracks = stream?.getAudioTracks().filter((t) => t.readyState === 'live') ?? []
  if (tracks.length === 0) return null
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : ''
  const recorder = new MediaRecorder(new MediaStream(tracks), mimeType ? { mimeType } : undefined)
  const chunks: Blob[] = []
  let startedAt = performance.now()
  recorder.addEventListener('dataavailable', (e) => chunks.push(e.data))
  recorder.addEventListener('start', () => {
    startedAt = performance.now()
  })
  recorder.start()
  return {
    sampleRate: tracks[0].getSettings().sampleRate ?? 48_000,
    stop: (onDone?: (audio: Blob, startedAt: number, endedAt: number) => void) => {
      if (recorder.state === 'inactive') return
      recorder.addEventListener('stop', () => onDone?.(new Blob(chunks, { type: recorder.mimeType }), startedAt, performance.now()), {
        once: true,
      })
      recorder.stop()
    },
  }
}

/**
 * Full-window color challenge. Steps through the colors on the animation clock,
 * reports each step's first frame via onStep, records the mic for the whole
 * reading window, then hands the audio to the client and closes.
 */
export function ChallengeOverlay({ challenge, client, stream }: ChallengeOverlayProps) {
  const total = challenge.colors.length
  const [index, setIndex] = useState(0)
  const [secondsLeft, setSecondsLeft] = useState(Math.ceil((total * challenge.stepMs) / 1000))
  const [toneOn, setToneOn] = useState(false)
  const reported = useRef(new Set<number>())

  useEffect(() => {
    const durationMs = total * challenge.stepMs
    const recorder = startRecorder(stream)
    const tone = challenge.sonar ? startTone() : null
    void tone?.ready.then((running) => setToneOn(running))
    let raf = 0
    let finished = false
    let shown = -1
    let lastSeconds = -1
    const t0 = performance.now()

    const finish = () => {
      finished = true
      tone?.stop()
      if (recorder) {
        recorder.stop((audio, startedAt, endedAt) => {
          client.onChallengeAudio(audio, { startedAt, endedAt, sampleRate: recorder.sampleRate })
          client.endChallenge(challenge.id)
        })
      } else {
        client.endChallenge(challenge.id)
      }
    }

    const frame = (now: number) => {
      const elapsed = now - t0
      if (elapsed >= durationMs) return finish()
      const i = Math.floor(elapsed / challenge.stepMs)
      if (i !== shown) {
        shown = i
        setIndex(i)
      }
      const s = Math.ceil((durationMs - elapsed) / 1000)
      if (s !== lastSeconds) {
        lastSeconds = s
        setSecondsLeft(s)
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      if (!finished) {
        // Unmounted early (e.g. StrictMode remount): discard this run without ending the challenge.
        tone?.stop()
        recorder?.stop()
      }
    }
  }, [challenge, client, stream, total])

  // Report the first frame on which each color is on screen (the frame after React commits it).
  useEffect(() => {
    if (reported.current.has(index)) return
    const color = challenge.colors[index]
    const raf = requestAnimationFrame((t) => {
      reported.current.add(index)
      client.onStep(index, color, t)
    })
    return () => cancelAnimationFrame(raf)
  }, [index, challenge, client])

  const cameraOn = stream?.getVideoTracks().some((t) => t.readyState === 'live' && t.enabled) ?? false
  const micOn = stream?.getAudioTracks().some((t) => t.readyState === 'live' && t.enabled) ?? false

  return (
    <div
      className="challenge"
      style={{ backgroundColor: challenge.colors[index] }}
      role="dialog"
      aria-modal="true"
      aria-label="preSense check"
    >
      <div className="challenge__center">
        <div className="challenge__chip">
          <ShieldCheck size={15} aria-hidden />
          preSense check · requested by {challenge.requestedBy}
        </div>

        <div className="challenge__card">
          <div className="challenge__prompt">Keep your face in view and read aloud</div>
          <p className="challenge__phrase">{challenge.phrase}</p>
          <ol className="challenge__steps" aria-label={`Color ${index + 1} of ${total}`}>
            {challenge.colors.map((color, i) => (
              <li
                key={i}
                className={i < index ? 'step step--done' : i === index ? 'step step--current' : 'step step--upcoming'}
                // Upcoming colors are never revealed.
                style={i <= index ? { backgroundColor: color } : undefined}
              />
            ))}
          </ol>
          <div className="challenge__meta tabular" aria-live="polite">
            Color {index + 1} of {total} · {secondsLeft}s left
          </div>
        </div>

        <div className="challenge__status">
          {challenge.sonar && toneOn && (
            <span className="challenge__chip challenge__chip--quiet">
              <AudioWaveform size={14} aria-hidden />
              Inaudible ultrasonic tone playing
            </span>
          )}
          <span className="challenge__chip challenge__chip--quiet">
            {cameraOn ? <Video size={14} aria-hidden /> : <VideoOff size={14} aria-hidden />}
            {cameraOn && micOn ? 'Camera and mic on' : cameraOn ? 'Camera on · mic off' : micOn ? 'Mic on · camera off' : 'Camera and mic off'}
          </span>
        </div>
      </div>

      <div className="self-pip">
        {stream && cameraOn ? <VideoView stream={stream} mirrored /> : <div className="pip__off"><VideoOff size={18} aria-hidden /></div>}
        <span className="self-pip__label">You</span>
      </div>
    </div>
  )
}
