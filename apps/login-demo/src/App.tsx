import { useEffect, useState } from 'react'
import type { SPCameraDataTypeResult } from './knock-native'
import './App.css'

// Temporary page: dumps raw native camera info. No verdict logic yet.
function App() {
  const [result, setResult] = useState<SPCameraDataTypeResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const native = window.knockNative

  useEffect(() => {
    native
      ?.listVideoDevices()
      .then(setResult)
      .catch((err: unknown) => setError(String(err)))
  }, [native])

  const devices = result?.SPCameraDataType ?? []

  return (
    <main>
      <h1>Video devices</h1>
      {!native && (
        <pre className="error">window.knockNative is not available (not running in Electron).</pre>
      )}
      {error && <pre className="error">{error}</pre>}
      {native && !result && !error && <p>Loading…</p>}
      {result && devices.length === 0 && <p>No cameras found.</p>}
      <ul>
        {devices.map((device, i) => (
          <li key={i}>
            <h2>{device._name}</h2>
            <pre>{JSON.stringify(device, null, 2)}</pre>
          </li>
        ))}
      </ul>
    </main>
  )
}

export default App
