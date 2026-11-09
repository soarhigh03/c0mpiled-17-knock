import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { EnvironmentChangeReason, NativeEnvironment } from '../src/environment/types.ts'
import type { VoiceWindowResult } from './voice.ts'

function on<Args extends unknown[]>(channel: string, cb: (...args: Args) => void): () => void {
  const listener = (_event: IpcRendererEvent, ...args: unknown[]) => cb(...(args as Args))
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('knockNative', {
  getVoiceAvailability: (): Promise<boolean> => ipcRenderer.invoke('knock-native:get-voice-availability'),
  onVoiceAvailabilityChanged: (cb: (available: boolean) => void) => on('knock-native:voice-availability-changed', cb),
  analyzeVoiceWindow: (pcm16: ArrayBuffer): Promise<VoiceWindowResult> => ipcRenderer.invoke('knock-native:analyze-voice-window', pcm16),
  listVideoDevices: () => ipcRenderer.invoke('knock-native:list-video-devices'),
  getEnvironment: (): Promise<NativeEnvironment> => ipcRenderer.invoke('knock-native:get-environment'),
  onEnvironmentChanged: (cb: (env: NativeEnvironment, reason: EnvironmentChangeReason) => void) =>
    on('knock-native:environment-changed', cb),
  getContentProtection: (): Promise<boolean> => ipcRenderer.invoke('knock-native:get-content-protection'),
  onContentProtectionChanged: (cb: (enabled: boolean) => void) => on('knock-native:content-protection-changed', cb),
})
