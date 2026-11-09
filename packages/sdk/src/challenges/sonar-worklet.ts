/**
 * The receiving half of the sonar probe, which has to run on the audio thread.
 *
 * It mixes the microphone signal down with the carrier (I/Q), low-passes and
 * decimates to ~1 kHz, subtracts the slowly-varying DC term — the direct
 * speaker→mic path plus every static reflection in the room — and posts the
 * RMS of what is left. That residue is the part of the echo whose phase is
 * changing, i.e. the Doppler return from something moving, and its magnitude
 * tracks the reflector's speed.
 *
 * The source is kept as a string and loaded through a blob URL so the SDK
 * stays an ordinary module graph: host apps don't have to copy a worklet file
 * into their public directory or teach their bundler about worklet assets.
 */

export const SONAR_PROCESSOR_NAME = 'knock-sonar-demod'

/** Baseband rate after decimation, Hz. Mouth Doppler sits well under 100 Hz. */
export const BASEBAND_HZ = 1_000

/** Movement-energy frames posted to the main thread per second. */
export const FRAME_HZ = 100

/**
 * Corner frequency of the DC tracker, Hz. Low enough to keep the Doppler from
 * a speaking mouth (~10 Hz and up at 19 kHz), high enough to follow the drift
 * of a static room.
 */
export const DC_CORNER_HZ = 3

export interface SonarWorkletOptions {
  carrierHz: number
  /** Input samples per baseband sample. */
  decim: number
  /** Baseband samples per posted frame. */
  frameLen: number
  /** Pole of the one-pole DC tracker, at the baseband rate. */
  dcAlpha: number
}

export interface SonarFrameMessage {
  /** Audio-clock sample index at the centre of the frame. */
  sample: number
  /** RMS of the DC-removed baseband over the frame; ∝ reflector speed. */
  rms: number
}

export const SONAR_WORKLET_SOURCE = `
const TWO_PI = Math.PI * 2;

class KnockSonarDemod extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions;
    this.step = (TWO_PI * o.carrierHz) / sampleRate;
    this.decim = o.decim;
    this.frameLen = o.frameLen;
    this.alpha = o.dcAlpha;
    this.span = o.decim * o.frameLen;
    this.phase = 0;
    this.accI = 0;
    this.accQ = 0;
    this.accN = 0;
    this.dcI = 0;
    this.dcQ = 0;
    this.power = 0;
    this.frameN = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      // Mix down with exp(-j*w*t): the carrier lands at DC.
      const x = channel[i];
      this.accI += x * Math.cos(this.phase);
      this.accQ -= x * Math.sin(this.phase);
      this.phase += this.step;
      if (this.phase >= TWO_PI) this.phase -= TWO_PI;

      // Boxcar low-pass, then decimate.
      if (++this.accN < this.decim) continue;
      let bi = this.accI / this.decim;
      let bq = this.accQ / this.decim;
      this.accI = 0;
      this.accQ = 0;
      this.accN = 0;

      // Drop the static part of the echo; keep what is moving.
      this.dcI += (bi - this.dcI) * (1 - this.alpha);
      this.dcQ += (bq - this.dcQ) * (1 - this.alpha);
      bi -= this.dcI;
      bq -= this.dcQ;
      this.power += bi * bi + bq * bq;

      if (++this.frameN < this.frameLen) continue;
      this.port.postMessage({
        sample: currentFrame + i - this.span / 2,
        rms: Math.sqrt(this.power / this.frameLen),
      });
      this.power = 0;
      this.frameN = 0;
    }

    return true;
  }
}

registerProcessor(${JSON.stringify(SONAR_PROCESSOR_NAME)}, KnockSonarDemod);
`
