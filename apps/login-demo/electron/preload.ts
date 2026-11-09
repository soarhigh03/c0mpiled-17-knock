import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('knockNative', {
  listVideoDevices: () => ipcRenderer.invoke('knock-native:list-video-devices'),
})
