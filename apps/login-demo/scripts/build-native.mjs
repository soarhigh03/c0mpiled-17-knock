// Compiles native/knock-devices.swift when the source is newer than the binary (macOS only).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import path from 'node:path'

const root = path.join(import.meta.dirname, '..')
const source = path.join(root, 'native/knock-devices.swift')
const binary = path.join(root, 'native/bin/knock-devices')

if (process.platform !== 'darwin') {
  console.log('[knock] skipping native device probe (macOS only)')
  process.exit(0)
}
if (existsSync(binary) && statSync(binary).mtimeMs >= statSync(source).mtimeMs) process.exit(0)

mkdirSync(path.dirname(binary), { recursive: true })
try {
  execFileSync('xcrun', ['swiftc', '-O', source, '-o', binary], { stdio: 'inherit' })
  console.log('[knock] built native/bin/knock-devices')
} catch {
  // The app falls back to system_profiler (every device lands in "review").
  console.warn('[knock] could not build the Swift device probe; install Xcode Command Line Tools')
}
