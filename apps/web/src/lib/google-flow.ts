// The web server's half of Google sign-in: values issued before the redirect
// to Google and checked when the browser comes back. They live in an httpOnly
// cookie scoped to /auth/google, so page scripts never see them.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const FLOW_COOKIE = 'labops_google_flow';
export const FLOW_MAX_AGE_SECONDS = 600;
export const FLOW_PATH = '/auth/google';

const value = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const flowSchema = z.object({ state: value, codeVerifier: value, nonce: value }).strict();
export type GoogleFlow = z.infer<typeof flowSchema>;

const random = () => randomBytes(32).toString('base64url');

export function newFlow(): GoogleFlow {
  return { state: random(), codeVerifier: random(), nonce: random() };
}

/** PKCE S256: Google gets the hash now and the verifier only at the exchange. */
export const codeChallenge = (codeVerifier: string): string =>
  createHash('sha256').update(codeVerifier).digest('base64url');

export const encodeFlow = (flow: GoogleFlow): string =>
  Buffer.from(JSON.stringify(flow)).toString('base64url');

/** Null for a missing, tampered or malformed cookie. */
export function decodeFlow(raw: string | undefined): GoogleFlow | null {
  if (!raw) return null;
  try {
    const parsed = flowSchema.safeParse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Constant time, so a forged callback learns nothing from how fast it fails. */
export function stateMatches(expected: string, actual: string | null): boolean {
  if (!actual) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

// A fixed set, so the login page never echoes text from the URL.
const ERRORS: Record<string, string> = {
  google_cancelled: 'Google sign-in was cancelled.',
  google_not_allowed: 'This Google account is not allowed to sign in.',
  google_failed: 'Google sign-in could not be completed. Try again.',
  google_unavailable: 'Google sign-in is not available right now.',
};

export const googleErrorMessage = (code: string | undefined): string | null =>
  code !== undefined && Object.hasOwn(ERRORS, code) ? ERRORS[code] : null;
