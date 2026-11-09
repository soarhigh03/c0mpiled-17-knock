import { serve } from '@hono/node-server'
import { app } from './app.ts'
import { config } from './config.ts'

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[knock] API listening on http://localhost:${info.port}`)
})
