import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { config } from './config.ts'
import { sessions } from './routes/sessions.ts'
import { tokens } from './routes/tokens.ts'

export const app = new Hono()

app.use('*', logger())
app.use('*', cors({ origin: config.allowedOrigins }))

app.get('/health', (c) => c.json({ ok: true }))
app.route('/v1/sessions', sessions)
app.route('/v1/tokens', tokens)
