import { SignJWT, jwtVerify } from 'jose'
import { TrustTokenClaims } from '@knock/shared'
import { config } from './config.ts'

const secret = new TextEncoder().encode(config.tokenSecret)
const ISSUER = 'knock'

export async function signTrustToken(claims: TrustTokenClaims): Promise<string> {
  return new SignJWT({ human: claims.human, score: claims.score, checks: claims.checks })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(config.tokenTtl)
    .sign(secret)
}

export async function verifyTrustToken(token: string): Promise<TrustTokenClaims> {
  const { payload } = await jwtVerify(token, secret, { issuer: ISSUER })
  return TrustTokenClaims.parse(payload)
}
