import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { screen, type BrowserWindow } from 'electron'
import { classifyDevice } from '../src/environment/classify.ts'
import { matchSuspiciousProcesses } from '../src/environment/processes.ts'
import type {
  DeviceKind,
  DisplayInfo,
  EnvironmentChangeReason,
  FocusStats,
  NativeDevice,
  NativeEnvironment,
  RawCaptureDevice,
  SuspiciousProcess,
} from '../src/environment/types.ts'

const execFileAsync = promisify(execFile)

/** Built by scripts/build-native.mjs from native/knock-devices.swift. */
const DEVICE_PROBE = path.join(import.meta.dirname, '../native/bin/knock-devices')
const POLL_MS = 3000

function toNative(kind: DeviceKind, raw: RawCaptureDevice): NativeDevice {
  return { kind, name: raw.name, raw, classification: classifyDevice(kind, raw) }
}

async function probeWithAVFoundation(): Promise<Pick<NativeEnvironment, 'cameras' | 'microphones'>> {
  const { stdout } = await execFileAsync(DEVICE_PROBE, [], { timeout: 5000 })
  const out = JSON.parse(stdout) as { cameras: RawCaptureDevice[]; microphones: RawCaptureDevice[] }
  return {
    cameras: out.cameras.map((d) => toNative('camera', d)),
    microphones: out.microphones.map((d) => toNative('microphone', d)),
  }
}

/** Fallback without transport types: everything not blocked by name lands in "review". */
async function probeWithSystemProfiler(): Promise<Pick<NativeEnvironment, 'cameras' | 'microphones'>> {
  const { stdout } = await execFileAsync('/usr/sbin/system_profiler', ['SPCameraDataType', 'SPAudioDataType', '-json'], {
    timeout: 15000,
  })
  const out = JSON.parse(stdout) as {
    SPCameraDataType?: Record<string, string>[]
    SPAudioDataType?: { _items?: Record<string, string | number>[] }[]
  }
  const cameras = (out.SPCameraDataType ?? []).map((c) =>
    toNative('camera', {
      name: c._name,
      uniqueID: c['spcamera_unique-id'] ?? '',
      modelID: c['spcamera_model-id'] ?? '',
      manufacturer: '',
      deviceType: '',
      transportType: '',
    }),
  )
  const microphones = (out.SPAudioDataType ?? [])
    .flatMap((group) => group._items ?? [])
    .filter((item) => item.coreaudio_device_input)
    .map((item) =>
      toNative('microphone', {
        name: String(item._name),
        uniqueID: '',
        modelID: '',
        manufacturer: String(item.coreaudio_device_manufacturer ?? ''),
        deviceType: '',
        transportType: '',
      }),
    )
  return { cameras, microphones }
}

async function listSuspiciousProcesses(): Promise<SuspiciousProcess[]> {
  const { stdout } = await execFileAsync('/bin/ps', ['-axo', 'comm='], { maxBuffer: 8 * 1024 * 1024 })
  return matchSuspiciousProcesses(stdout.split('\n'))
}

function listDisplays(): DisplayInfo[] {
  return screen.getAllDisplays().map((d) => ({
    id: d.id,
    label: d.label,
    internal: d.internal,
    width: d.size.width,
    height: d.size.height,
    scaleFactor: d.scaleFactor,
  }))
}

/**
 * Collects the native environment and reports changes: displays added/removed,
 * window blur/focus (with blur durations), and a 3 s poll for devices and processes.
 */
export class EnvironmentMonitor {
  private readonly focus: FocusStats = { blurCount: 0, totalBlurMs: 0, lastBlurMs: null }
  private blurredAt: number | null = null
  private deviceSignature = ''
  private processSignature = ''
  private timer: ReturnType<typeof setInterval> | null = null
  private source: NativeEnvironment['source'] = existsSync(DEVICE_PROBE) ? 'avfoundation' : 'system_profiler'

  private readonly win: BrowserWindow
  private readonly emit: (env: NativeEnvironment, reason: EnvironmentChangeReason) => void

  constructor(win: BrowserWindow, emit: (env: NativeEnvironment, reason: EnvironmentChangeReason) => void) {
    this.win = win
    this.emit = emit
  }

  start(): void {
    const onDisplays = () => void this.collect().then((env) => this.emit(env, 'displays'))
    screen.on('display-added', onDisplays)
    screen.on('display-removed', onDisplays)

    this.win.on('blur', () => {
      this.blurredAt = Date.now()
      this.focus.blurCount++
      void this.collect().then((env) => this.emit(env, 'focus'))
    })
    this.win.on('focus', () => {
      if (this.blurredAt !== null) {
        this.focus.lastBlurMs = Date.now() - this.blurredAt
        this.focus.totalBlurMs += this.focus.lastBlurMs
        this.blurredAt = null
      }
      void this.collect().then((env) => this.emit(env, 'focus'))
    })

    this.timer = setInterval(() => void this.poll(), POLL_MS)
    this.win.on('closed', () => {
      if (this.timer) clearInterval(this.timer)
      screen.off('display-added', onDisplays)
      screen.off('display-removed', onDisplays)
    })
  }

  async collect(): Promise<NativeEnvironment> {
    const [devices, suspiciousProcesses] = await Promise.all([this.probeDevices(), listSuspiciousProcesses()])
    return {
      source: this.source,
      ...devices,
      displays: listDisplays(),
      suspiciousProcesses,
      windowFocused: !this.win.isDestroyed() && this.win.isFocused(),
      focus: { ...this.focus },
      collectedAt: Date.now(),
    }
  }

  private async probeDevices() {
    if (this.source === 'avfoundation') {
      try {
        return await probeWithAVFoundation()
      } catch (err) {
        console.warn('[knock] AVFoundation probe failed, falling back to system_profiler:', err)
        this.source = 'system_profiler'
      }
    }
    return probeWithSystemProfiler()
  }

  /** Emits only when devices or processes actually changed. */
  private async poll(): Promise<void> {
    if (this.win.isDestroyed()) return
    const env = await this.collect()
    const devices = JSON.stringify(
      [...env.cameras, ...env.microphones].map((d) => [d.kind, d.raw.uniqueID, d.name, d.classification.verdict]),
    )
    const processes = env.suspiciousProcesses.map((p) => p.app).join()
    const first = this.deviceSignature === ''
    const devicesChanged = devices !== this.deviceSignature
    const processesChanged = processes !== this.processSignature
    this.deviceSignature = devices
    this.processSignature = processes
    if (first) return
    if (devicesChanged) this.emit(env, 'devices')
    else if (processesChanged) this.emit(env, 'processes')
  }
}
