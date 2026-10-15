// Google sign-in, server-side. Builds the authorization URL, exchanges the code
// with the client secret, and verifies the ID token. The browser only relays
// the code; who the person is comes from Google's signed token, checked here.

import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTVerifyGetKey } from 'jose';

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  allowedEmails: string[];
}

/** Injectable so tests never call Google: a stub token endpoint and local keys. */
export interface GoogleDeps {
  fetchImpl?: typeof fetch;
  keys?: JWTVerifyGetKey;
}

export interface GoogleIdentity {
  subject: string;
  email: string;
}

export type GoogleFailure = 'exchange_failed' | 'invalid_token' | 'email_unverified' | 'not_allowed';

export class GoogleSignInError extends Error {
  constructor(readonly reason: GoogleFailure) {
    super(`google sign-in failed: ${reason}`);
    this.name = 'GoogleSignInError';
  }
}

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
// Fetched on first use and cached; refetched only when a token names a new key.
const GOOGLE_KEYS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const EXCHANGE_TIMEOUT_MS = 10_000;

export function authorizationUrl(
  config: GoogleConfig,
  request: { state: string; codeChallenge: string; nonce: string },
): string {
  const query = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'openid email',
    state: request.state,
    nonce: request.nonce,
    code_challenge: request.codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return `${AUTHORIZE_URL}?${query}`;
}

/**
 * Exchanges the code and returns who signed in, or throws GoogleSignInError.
 * The token's signature, issuer, audience and expiry come from jose; the nonce
 * ties it to this browser's request; only a verified, allowed email passes.
 */
export async function verifyGoogleSignIn(
  config: GoogleConfig,
  input: { code: string; codeVerifier: string; nonce: string },
  deps: GoogleDeps = {},
): Promise<GoogleIdentity> {
  let idToken: unknown;
  try {
    const response = await (deps.fetchImpl ?? fetch)(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: input.code,
        code_verifier: input.codeVerifier,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
    });
    if (!response.ok) throw new GoogleSignInError('exchange_failed');
    idToken = ((await response.json()) as { id_token?: unknown }).id_token;
  } catch (error) {
    if (error instanceof GoogleSignInError) throw error;
    throw new GoogleSignInError('exchange_failed');
  }
  if (typeof idToken !== 'string') throw new GoogleSignInError('exchange_failed');

  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, deps.keys ?? GOOGLE_KEYS, {
      issuer: ISSUERS,
      audience: config.clientId,
      algorithms: ['RS256'],
    }));
  } catch {
    throw new GoogleSignInError('invalid_token');
  }
  // A token minted for another sign-in attempt must not be replayed into this one.
  if (payload.nonce !== input.nonce || typeof payload.sub !== 'string') {
    throw new GoogleSignInError('invalid_token');
  }
  if (payload.email_verified !== true || typeof payload.email !== 'string') {
    throw new GoogleSignInError('email_unverified');
  }
  const email = payload.email.toLowerCase();
  if (!config.allowedEmails.includes(email)) throw new GoogleSignInError('not_allowed');
  return { subject: payload.sub, email };
}
