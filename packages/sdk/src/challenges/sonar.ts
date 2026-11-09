import type { SonarChallenge, SonarEvidence } from '@knock/shared'
import type { RunContext } from '../client.ts'

/**
 * Emit a near-ultrasonic carrier keyed by the server pattern, record the echo,
 * and extract Doppler energy around the carrier; pair it with mouth aperture.
 *
 * Mic MUST be opened with echoCancellation/noiseSuppression/autoGainControl = false,
 * otherwise the browser filters out the echo. Keep the probe out of the outgoing call audio.
 *
 * TODO(signal):
 *  - AnalyserNode/AudioWorklet FFT, sum energy in ±(50..300)Hz sidebands of carrier, excluding the carrier bin
 *  - mouth aperture from MediaPipe Face Landmarker (upper/lower lip distance / face height)
 */
export async function runSonar(challenge: SonarChallenge, ctx: RunContext): Promise<SonarEvidence> {
  void ctx
  const mic = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  })
  const ac = new AudioContext({ sampleRate: 48_000 })

  const osc = ac.createOscillator()
  osc.frequency.value = challenge.carriersHz[0]!
  const gain = ac.createGain()
  gain.gain.value = 0
  osc.connect(gain).connect(ac.destination)
  osc.start()

  // On/off keying per server pattern.
  challenge.pattern.forEach((bit, i) => {
    gain.gain.setValueAtTime(bit ? 0.3 : 0, ac.currentTime + (i * challenge.slotMs) / 1000)
  })

  const analyser = ac.createAnalyser()
  analyser.fftSize = 8192
  ac.createMediaStreamSource(mic).connect(analyser)

  const doppler: SonarEvidence['doppler'] = []
  const mouthAperture: SonarEvidence['mouthAperture'] = []
  const t0 = performance.now()
  await new Promise<void>((resolve) => {
    const tick = () => {
      const t = performance.now() - t0
      if (t >= challenge.durationMs) return resolve()
      doppler.push({ t, energy: 0 }) // TODO: real sideband energy
      mouthAperture.push({ t, value: 0 }) // TODO: real landmark aperture
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

  osc.stop()
  mic.getTracks().forEach((tr) => tr.stop())
  await ac.close()
  return { kind: 'sonar', doppler, mouthAperture, sampleRate: ac.sampleRate }
}
