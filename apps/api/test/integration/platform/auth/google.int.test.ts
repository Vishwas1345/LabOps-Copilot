// Google sign-in against the real database, with nothing calling Google: a
// local key signs the ID tokens and a stub replaces the token endpoint.

import { randomBytes, randomUUID } from 'node:crypto';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { JWTPayload } from 'jose';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../../src/app.js';
import { prisma } from '../../../../src/db.js';
import { loadConfig } from '../../../../src/platform/config/env.js';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const CLIENT_SECRET = 'google-client-secret-never-echoed-7c1d';
const ALLOWED = `ops-${randomUUID()}@example.test`;
const OTHER_ALLOWED = `lead-${randomUUID()}@example.test`;

const { privateKey, publicKey } = await generateKeyPair('RS256');
const { privateKey: strangerKey } = await generateKeyPair('RS256');
const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256' }] });

const b64 = () => randomBytes(32).toString('base64url');

/** What the stub token endpoint returns next, and what it was sent. */
let nextIdToken: string | null = null;
let tokenStatus = 200;
const sentToGoogle: string[] = [];
const fetchImpl: typeof fetch = async (_url, init) => {
  sentToGoogle.push(String(init?.body));
  return new Response(JSON.stringify(nextIdToken ? { id_token: nextIdToken } : {}), { status: tokenStatus });
};

const googleEnv = {
  GOOGLE_CLIENT_ID: CLIENT_ID,
  GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
  GOOGLE_REDIRECT_URI: 'http://localhost:3000/auth/google/callback',
  GOOGLE_ALLOWED_EMAILS: [ALLOWED, OTHER_ALLOWED],
};
const app = await buildApp({
  config: { ...loadConfig(), DEMO_ENABLED: false, ...googleEnv },
  googleDeps: { fetchImpl, keys },
});
const plain = await buildApp({ config: { ...loadConfig(), DEMO_ENABLED: false } });

afterAll(async () => {
  await prisma.operator.deleteMany({ where: { username: { in: [ALLOWED, OTHER_ALLOWED] } } });
  await app.close();
  await plain.close();
  await prisma.$disconnect();
});

async function idToken(claims: JWTPayload, options: { key?: CryptoKey; exp?: string } = {}) {
  return new SignJWT({ email_verified: true, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer((claims.iss as string) ?? 'https://accounts.google.com')
    .setAudience((claims.aud as string) ?? CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime(options.exp ?? '5m')
    .sign(options.key ?? privateKey);
}

// Each attempt from its own address, so the shared login limit stays out of it.
let address = 0;
async function signIn(token: string | null, nonce = b64()) {
  nextIdToken = token;
  address += 1;
  return app.inject({
    method: 'POST',
    url: '/api/auth/google',
    remoteAddress: `10.9.0.${address}`,
    payload: { code: 'code-from-google', codeVerifier: b64(), nonce },
  });
}

const lastGoogleAudit = () =>
  prisma.auditEntry.findFirstOrThrow({ where: { action: 'auth.login' }, orderBy: { seq: 'desc' } });

describe('Google sign-in', () => {
  it('offers Google only when it is configured', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/auth/providers' })).json()).toEqual({ data: { google: true } });
    expect((await plain.inject({ method: 'GET', url: '/api/auth/providers' })).json()).toEqual({ data: { google: false } });
  });

  it('builds the authorization URL with PKCE, state and nonce', async () => {
    const state = b64();
    const codeChallenge = b64();
    const nonce = b64();
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/google/authorization-url',
      payload: { state, codeChallenge, nonce },
    });
    const url = new URL(response.json().data.url);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: CLIENT_ID,
      redirect_uri: 'http://localhost:3000/auth/google/callback',
      response_type: 'code',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    // Negative: the secret never leaves the API.
    expect(response.body).not.toContain(CLIENT_SECRET);
  });

  it('refuses malformed flow values and an unconfigured deployment', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/api/auth/google/authorization-url',
      payload: { state: 'short', codeChallenge: b64(), nonce: b64() },
    });
    expect(bad.statusCode).toBe(400);
    for (const url of ['/api/auth/google/authorization-url', '/api/auth/google']) {
      const response = await plain.inject({ method: 'POST', url, payload: {} });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('GOOGLE_NOT_CONFIGURED');
    }
  });

  it('signs in an allowed, verified account and links it on first use', async () => {
    const subject = `google-${randomUUID()}`;
    const nonce = b64();
    const response = await signIn(await idToken({ sub: subject, email: ALLOWED.toUpperCase(), nonce }), nonce);

    expect(response.statusCode).toBe(200);
    expect(response.json().data.operator.username).toBe(ALLOWED);
    const cookie = response.headers['set-cookie'];
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: String(cookie).split(';')[0] } });
    expect(me.json().data.username).toBe(ALLOWED);
    const identity = await prisma.operatorIdentity.findUniqueOrThrow({
      where: { provider_subject: { provider: 'google', subject } },
    });
    expect(identity.email).toBe(ALLOWED);
    expect(await lastGoogleAudit()).toMatchObject({ outcome: 'succeeded', metadata: { provider: 'google' } });
    // The secret went to Google's token endpoint and nowhere back.
    expect(sentToGoogle.at(-1)).toContain(`client_secret=${CLIENT_SECRET}`);
    expect(response.body).not.toContain(CLIENT_SECRET);
  });

  it('returns the same operator for the same Google account every time', async () => {
    const subject = `google-${randomUUID()}`;
    const nonce = b64();
    const a = await signIn(await idToken({ sub: subject, email: OTHER_ALLOWED, nonce }), nonce);
    const nonce2 = b64();
    const b = await signIn(await idToken({ sub: subject, email: OTHER_ALLOWED, nonce: nonce2 }), nonce2);

    expect(a.json().data.operator.id).toBe(b.json().data.operator.id);
    expect(await prisma.operatorIdentity.count({ where: { subject } })).toBe(1);
  });

  // Negative: the allow-list decides, and a refusal leaves nothing behind.
  it('refuses an email that is not on the allow-list, creating nothing', async () => {
    const stranger = `stranger-${randomUUID()}@example.test`;
    const nonce = b64();
    const response = await signIn(await idToken({ sub: `google-${randomUUID()}`, email: stranger, nonce }), nonce);

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('GOOGLE_NOT_ALLOWED');
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(await prisma.operator.count({ where: { username: stranger } })).toBe(0);
    const audit = await lastGoogleAudit();
    expect(audit).toMatchObject({ outcome: 'rejected', metadata: { provider: 'google', reason: 'not_allowed' } });
    // The audit is permanent: it records why, never who.
    expect(JSON.stringify(audit.metadata)).not.toContain(stranger);
  });

  it('refuses an unverified Google email', async () => {
    const nonce = b64();
    const token = await idToken({ sub: `google-${randomUUID()}`, email: ALLOWED, email_verified: false, nonce });
    const response = await signIn(token, nonce);

    expect(response.statusCode).toBe(401);
    expect((await lastGoogleAudit()).metadata).toMatchObject({ reason: 'email_unverified' });
  });

  // Negative: every way a token can be wrong is refused the same way.
  it.each([
    ['signed by another key', { key: 'stranger' }],
    ['for another client', { aud: 'someone-else.apps.googleusercontent.com' }],
    ['from another issuer', { iss: 'https://evil.example' }],
    ['already expired', { exp: '-1m' }],
    ['minted for another attempt', { nonce: 'other' }],
  ] as const)('refuses a token %s', async (_label, change) => {
    const nonce = b64();
    const claims: JWTPayload = { sub: `google-${randomUUID()}`, email: ALLOWED, nonce };
    if ('aud' in change) claims.aud = change.aud;
    if ('iss' in change) claims.iss = change.iss;
    if ('nonce' in change) claims.nonce = change.nonce;
    const token = await idToken(claims, {
      key: 'key' in change ? strangerKey : undefined,
      exp: 'exp' in change ? change.exp : undefined,
    });
    const before = await prisma.operatorIdentity.count();
    const response = await signIn(token, nonce);

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('GOOGLE_SIGN_IN_FAILED');
    expect(await prisma.operatorIdentity.count()).toBe(before);
    expect((await lastGoogleAudit()).metadata).toMatchObject({ reason: 'invalid_token' });
  });

  it('refuses when Google will not exchange the code', async () => {
    tokenStatus = 400;
    const response = await signIn(null);
    tokenStatus = 200;

    expect(response.statusCode).toBe(401);
    expect((await lastGoogleAudit()).metadata).toMatchObject({ reason: 'exchange_failed' });
  });

  // Negative: an operator created through Google has no password to guess.
  it('never lets a password reach an operator created through Google', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: '10.9.1.1',
      payload: { username: ALLOWED, password: 'any-password-at-all' },
    });
    expect(response.statusCode).toBe(401);
  });
});
