export const config = {
  port: Number(process.env.PORT ?? 8787),
  tokenSecret: process.env.KNOCK_TOKEN_SECRET ?? 'change-me-dev-secret',
  allowedOrigins: (process.env.KNOCK_ALLOWED_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim()),
  sessionTtlMs: 5 * 60_000,
  tokenTtl: '15m',
  /** Overall score needed to be judged human. */
  humanThreshold: 0.7,
}
