import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron/simple'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths so dist/index.html works when loaded via file://
  base: './',
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
      },
      preload: {
        input: 'electron/preload.ts',
        vite: {
          build: {
            rolldownOptions: {
              // Sandboxed preload scripts must be CommonJS
              output: { entryFileNames: '[name].cjs' },
            },
          },
        },
      },
    }),
  ],
  // meet uses 5173; fail instead of drifting so CORS origins stay predictable
  server: { port: 5174, strictPort: true },
  envDir: '../..',
})
