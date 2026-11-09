/**
 * The receiving half of the sonar probe, which has to run on the audio thread.
 *
 * It mixes the microphone signal down with the carrier (I/Q), low-passes and
 * decimates to ~1 kHz, band-passes to the Doppler shifts a speaking mouth
 * produces, and posts the RMS of what is left. The lower edge removes the
 * direct speaker→mic path and every static reflection; the upper edge removes
 * reflectors moving faster than lips ever do.
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
 * Baseband band-pass, Hz — the Doppler a speaking mouth actually produces.
 *
 * A shift of f_d = 2·v·f/c means that at 19 kHz, 6–45 Hz is a reflector moving
 * at roughly 0.05–0.4 m/s, which is the range of lip and jaw motion during
 * speech. Below it sits the drift of a static room and the slow sway of a
 * torso; above it, hands and arms. Keeping everything above a DC tracker, as
 * this did at first, hands the measurement to whatever moves most — and a head
 * or a hand is a far bigger reflector than a pair of lips, so the lips end up
 * buried under motion that has nothing to do with speech.
 */
export const BAND_LOW_HZ = 6
export const BAND_HIGH_HZ = 45

export interface SonarWorkletOptions {
  carrierHz: number
  /** Input samples per baseband sample. */
  decim: number
  /** Baseband samples per posted frame. */
  frameLen: number
  /** Pole of the one-pole DC tracker (band-pass lower edge). */
  dcAlpha: number
  /** Pole of the one-pole smoother (band-pass upper edge). */
  lpBeta: number
}

export interface SonarFrameMessage {
  /** Audio-clock sample index at the centre of the frame. */
  sample: number
  /** RMS of the band-passed baseband over the frame; ∝ reflector speed. */
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
    this.beta = o.lpBeta;
    this.span = o.decim * o.frameLen;
    this.phase = 0;
    this.accI = 0;
    this.accQ = 0;
    this.accN = 0;
    this.dcI = 0;
    this.dcQ = 0;
    this.lpI = 0;
    this.lpQ = 0;
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
      const bi = this.accI / this.decim;
      const bq = this.accQ / this.decim;
      this.accI = 0;
      this.accQ = 0;
      this.accN = 0;

      // Band-pass to lip speeds. The DC tracker takes out the static room and
      // slow body sway; the smoother takes out hands and other fast movers.
      this.dcI += (bi - this.dcI) * (1 - this.alpha);
      this.dcQ += (bq - this.dcQ) * (1 - this.alpha);
      this.lpI += (bi - this.dcI - this.lpI) * (1 - this.beta);
      this.lpQ += (bq - this.dcQ - this.lpQ) * (1 - this.beta);
      this.power += this.lpI * this.lpI + this.lpQ * this.lpQ;

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
