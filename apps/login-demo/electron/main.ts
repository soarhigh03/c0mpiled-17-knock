import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { app, BrowserWindow, ipcMain, Menu, type IpcMainInvokeEvent } from 'electron'
import { EnvironmentMonitor } from './environment.ts'
import { VoiceSidecar, voiceUnavailable, isTrustedVoiceRenderer } from './voice.ts'

const execFileAsync = promisify(execFile)

const DIST = path.join(import.meta.dirname, '../dist')
const PRELOAD = path.join(import.meta.dirname, 'preload.cjs')
const voice = new VoiceSidecar({ servicePath: path.resolve(import.meta.dirname, '../../../services/knock-voice'),
  onAvailabilityChanged: available => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('knock-native:voice-availability-changed', available)
    }
  },
})

type Role = 'interviewer' | 'candidate'

/**
 * Screen-capture protection. Off by default in dev so demos can be recorded;
 * KNOCK_CONTENT_PROTECTION=1 or Demo ▸ Block Screen Capture turns it on.
 * The candidate role forces it on, unless KNOCK_CONTENT_PROTECTION=0 explicitly
 * allows recording the candidate window (e.g. for a demo video).
 */
const PROTECTION_ENV = process.env.KNOCK_CONTENT_PROTECTION
let protectionRequested = PROTECTION_ENV === '1' || (app.isPackaged && PROTECTION_ENV !== '0')
const candidateForced = PROTECTION_ENV !== '0'

function protectionLocked(win: BrowserWindow): boolean {
  return roleOf(win) === 'candidate' && candidateForced
}

/** One environment monitor per window (its focus/blur is per window). */
const monitors = new Map<number, EnvironmentMonitor>()

function roleOf(win: BrowserWindow): Role {
  try {
    return new URL(win.webContents.getURL()).searchParams.get('role') === 'candidate' ? 'candidate' : 'interviewer'
  } catch {
    return 'interviewer'
  }
}

/** Applies protection and tells the renderer what the window actually reports. */
function syncProtection(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  win.setContentProtection(protectionRequested || protectionLocked(win))
  win.webContents.send('knock-native:content-protection-changed', win.isContentProtected())
  if (win.isFocused()) buildMenu(win)
}

function load(win: BrowserWindow, role: Role): void {
  const query: Record<string, string> = role === 'candidate' ? { role: 'candidate' } : {}
  if (process.env.VITE_DEV_SERVER_URL) {
    const url = new URL(process.env.VITE_DEV_SERVER_URL)
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
    void win.loadURL(url.toString())
  } else {
    void win.loadFile(path.join(DIST, 'index.html'), { query })
  }
}

/** The application menu acts on the focused window, so it's rebuilt whenever focus moves. */
function buildMenu(win: BrowserWindow): void {
  const role = roleOf(win)
  const demo: Electron.MenuItemConstructorOptions = {
    label: 'Demo',
    submenu: [
      {
        label: 'Block Screen Capture',
        type: 'checkbox',
        checked: win.isContentProtected(),
        // Candidates are always protected unless KNOCK_CONTENT_PROTECTION=0.
        enabled: !protectionLocked(win),
        click: (item) => {
          protectionRequested = item.checked
          for (const w of BrowserWindow.getAllWindows()) syncProtection(w)
        },
      },
      { type: 'separator' },
      // Single-machine demo: the guest joins the same room from a second window.
      { label: 'Open Candidate Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => createWindow('candidate') },
      { type: 'separator' },
      { label: 'Interviewer View', type: 'radio', checked: role === 'interviewer', click: () => load(win, 'interviewer') },
      { label: 'Candidate View', type: 'radio', checked: role === 'candidate', click: () => load(win, 'candidate') },
    ],
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
      { role: 'editMenu' },
      { role: 'viewMenu' },
      demo,
      { role: 'windowMenu' },
    ]),
  )
}

ipcMain.handle('knock-native:list-video-devices', async () => {
  const { stdout } = await execFileAsync('/usr/sbin/system_profiler', [
    'SPCameraDataType',
    '-json',
  ])
  return JSON.parse(stdout)
})

ipcMain.handle('knock-native:get-environment', async (event) => {
  const monitor = monitors.get(event.sender.id)
  if (!monitor) throw new Error('Environment monitor not ready')
  return monitor.collect()
})

ipcMain.handle('knock-native:get-content-protection', (event) => {
  return BrowserWindow.fromWebContents(event.sender)?.isContentProtected() ?? false
})

function authorizeVoiceSender(event: IpcMainInvokeEvent): void {
  const win = BrowserWindow.fromWebContents(event.sender)
  const trusted = isTrustedVoiceRenderer({ knownWindow: !!win && monitors.has(event.sender.id),
    mainFrame: event.senderFrame === event.sender.mainFrame, candidate: !!win && roleOf(win) === 'candidate',
    url: event.senderFrame?.url ?? '', devUrl: process.env.VITE_DEV_SERVER_URL, indexPath: path.join(DIST, 'index.html') })
  if (!trusted) throw new Error('Voice IPC sender is not authorized')
}

ipcMain.handle('knock-native:get-voice-availability', event => {
  authorizeVoiceSender(event)
  return voice.available
})

ipcMain.handle('knock-native:analyze-voice-window', async (event, pcm: unknown) => {
  authorizeVoiceSender(event)
  if (!(pcm instanceof ArrayBuffer)) return { ...voiceUnavailable(), reason: 'invalid voice window' }
  return voice.analyze(pcm)
})

function createWindow(role: Role) {
  const others = BrowserWindow.getAllWindows().length
  const win = new BrowserWindow({
    // Offset extra windows so the demo's second window doesn't hide the first.
    ...(others > 0 ? { x: 80 + others * 40, y: 60 + others * 40 } : {}),
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

  const contentsId = win.webContents.id
  const monitor = new EnvironmentMonitor(win, (env, reason) => {
    if (!win.isDestroyed()) win.webContents.send('knock-native:environment-changed', env, reason)
  })
  monitor.start()
  monitors.set(contentsId, monitor)
  win.on('closed', () => monitors.delete(contentsId))
  win.on('focus', () => buildMenu(win))

  // Role comes from the URL, so re-apply protection whenever the page changes.
  win.webContents.on('did-navigate', () => syncProtection(win))
  win.webContents.on('did-navigate-in-page', () => syncProtection(win))
  win.webContents.on('did-finish-load', () => syncProtection(win))

  load(win, role)
  return win
}

const initialRole: Role = process.env.KNOCK_ROLE === 'candidate' ? 'candidate' : 'interviewer'

app.whenReady().then(() => {
  void voice.start()
  createWindow(initialRole)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(initialRole)
  })
})

let voiceShutdown = false
app.on('before-quit', (event) => {
  if (voiceShutdown) return
  event.preventDefault()
  voiceShutdown = true
  void voice.stop().finally(() => app.quit())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
