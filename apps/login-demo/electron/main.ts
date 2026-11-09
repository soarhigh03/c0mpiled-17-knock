import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { app, BrowserWindow, ipcMain } from 'electron'

const execFileAsync = promisify(execFile)

const DIST = path.join(import.meta.dirname, '../dist')
const PRELOAD = path.join(import.meta.dirname, 'preload.cjs')

ipcMain.handle('knock-native:list-video-devices', async () => {
  const { stdout } = await execFileAsync('/usr/sbin/system_profiler', [
    'SPCameraDataType',
    '-json',
  ])
  return JSON.parse(stdout)
})

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 760,
    title: 'Knock',
    backgroundColor: '#202124',
    // The renderer draws its own title bar (src/interviewer/TitleBar.tsx).
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 15 } }
      : {}),
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(DIST, 'index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
