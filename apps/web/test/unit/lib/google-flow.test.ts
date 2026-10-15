// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { codeChallenge, decodeFlow, encodeFlow, googleErrorMessage, newFlow, stateMatches } from '@/lib/google-flow';

describe('google flow values', () => {
  it('issues fresh 32-byte values each time', () => {
    const a = newFlow();
    const b = newFlow();
    expect(a.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.state).not.toBe(b.state);
    expect(a.codeVerifier).not.toBe(a.state);
  });

  it('derives the PKCE S256 challenge from the verifier', () => {
    const { codeVerifier } = newFlow();
    expect(codeChallenge(codeVerifier)).toBe(createHash('sha256').update(codeVerifier).digest('base64url'));
  });

  it('round-trips through the cookie encoding', () => {
    const flow = newFlow();
    expect(decodeFlow(encodeFlow(flow))).toEqual(flow);
  });

  // Negative: a missing or tampered cookie is no flow at all.
  it.each([undefined, '', 'not-base64-json', Buffer.from('{"state":"x"}').toString('base64url')])(
    'rejects a cookie that is %p',
    (raw) => {
      expect(decodeFlow(raw)).toBeNull();
    },
  );

  it('matches state exactly, and only exactly', () => {
    const { state } = newFlow();
    expect(stateMatches(state, state)).toBe(true);
    expect(stateMatches(state, null)).toBe(false);
    expect(stateMatches(state, `${state}x`)).toBe(false);
    expect(stateMatches(state, newFlow().state)).toBe(false);
  });

  // Negative: the login page never echoes text from the URL.
  it('maps only known error codes to messages', () => {
    expect(googleErrorMessage('google_not_allowed')).toMatch(/not allowed/);
    expect(googleErrorMessage('<script>')).toBeNull();
    expect(googleErrorMessage('toString')).toBeNull();
    expect(googleErrorMessage(undefined)).toBeNull();
  });
});
