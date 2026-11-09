import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { EnvironmentEvidence } from '@knock/shared'
import { classifyDevice } from './classify.ts'
import { matchNativeDevice, normalizeLabel, toEnvironmentEvidence } from './evidence.ts'
import { describeProcesses, matchSuspiciousProcesses } from './processes.ts'
import { DEVICE_SAMPLES } from './samples.ts'
import type { NativeEnvironment } from './types.ts'

describe('classifyDevice', () => {
  for (const sample of DEVICE_SAMPLES) {
    it(`${sample.source} → ${sample.expected}`, () => {
      assert.equal(classifyDevice(sample.kind, sample.raw).verdict, sample.expected)
    })
  }

  it('never allows a device on name alone', () => {
    const raw = { ...DEVICE_SAMPLES[0].raw, deviceType: '', transportType: '' }
    assert.equal(classifyDevice('camera', raw).verdict, 'review')
  })

  it('says "virtual device", never "fake"', () => {
    for (const sample of DEVICE_SAMPLES) {
      assert.doesNotMatch(classifyDevice(sample.kind, sample.raw).reason, /fake/i)
    }
  })
})

describe('matchSuspiciousProcesses', () => {
  it('finds apps by executable path and ignores lookalikes', () => {
    const ps = [
      '/sbin/launchd',
      '/Applications/OBS.app/Contents/MacOS/OBS',
      '/Applications/Voicemod.app/Contents/MacOS/Voicemod',
      '/System/Library/CoreServices/Finder.app/Contents/MacOS/Finder',
      '/usr/libexec/observerd',
      // Real path on the probe machine; the extension keeps running after OBS quits.
      '/Library/SystemExtensions/A1299E45-3AA5-4834-9A44-1E8713F8921E/com.obsproject.obs-studio.mac-camera-extension.systemextension/Contents/MacOS/com.obsproject.obs-studio.mac-camera-extension',
      '/Applications/Camouflage.app/Contents/MacOS/Camouflage',
    ]
    assert.deepEqual(
      matchSuspiciousProcesses(ps).map((p) => p.app),
      ['OBS Studio', 'Voicemod'],
    )
  })

  it('describes what to quit', () => {
    assert.equal(describeProcesses([]), 'No virtual camera or audio apps running')
    assert.equal(
      describeProcesses([{ app: 'OBS Studio', path: '/Applications/OBS.app/Contents/MacOS/OBS' }]),
      'OBS Studio is running — quit to continue',
    )
  })
})

describe('evidence', () => {
  it('matches browser labels to native devices', () => {
    const cam = { kind: 'camera' as const, name: '‘MacBook Pro’ 카메라', raw: DEVICE_SAMPLES[0].raw, classification: { verdict: 'allowed' as const, reason: '' } }
    assert.equal(normalizeLabel('HD Pro Webcam C920 (046d:082d)'), 'HD Pro Webcam C920')
    assert.equal(normalizeLabel('Default - MacBook Pro 마이크'), 'MacBook Pro 마이크')
    // Real Chromium labels on the probe machine.
    assert.equal(normalizeLabel('‘MacBook Pro’ 카메라 (0000:0001)'), '‘MacBook Pro’ 카메라')
    assert.equal(normalizeLabel('Default - MacBook Pro 마이크 (Built-in)'), 'MacBook Pro 마이크')
    assert.equal(matchNativeDevice('‘MacBook Pro’ 카메라', [cam]), cam)
    assert.equal(matchNativeDevice('OBS Virtual Camera', [cam]), null)
  })

  it('produces @knock/shared EnvironmentEvidence', () => {
    const env = { displays: [{}], focus: { blurCount: 2 } } as unknown as NativeEnvironment
    const evidence = toEnvironmentEvidence({
      devices: [
        { kind: 'videoinput', label: '‘MacBook Pro’ 카메라', deviceId: 'cam-1' },
        { kind: 'audioinput', label: 'Default - MacBook Pro 마이크', deviceId: 'default' },
        { kind: 'audioinput', label: 'MacBook Pro 마이크', deviceId: 'mic-1' },
      ],
      env,
      isFullscreen: false,
      userAgent: 'test',
    })
    assert.deepEqual(EnvironmentEvidence.parse(evidence), evidence)
    assert.equal(evidence.audioInputs.length, 1)
    assert.equal(evidence.screenCount, 1)
    assert.equal(evidence.focusLostCount, 2)
  })
})
