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
  /**
   * Fraction of the requested checks' weight that must have actually reached a
   * verdict. Stops a session passing on one surviving check when everything
   * harder to fool came back inconclusive.
   */
  minDecidedCoverage: 0.5,
}
