import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOLERANCE_SECONDS,
  sign,
  signatureHeader,
  verifySignature,
} from '../../../../src/modules/webhooks/signature.js';

const SECRET = 'test-webhook-secret';
const BODY = JSON.stringify({ labId: 'lab-1', type: 'provision_failed' });
const NOW = 1_700_000_000;

function verify(overrides: Partial<Parameters<typeof verifySignature>[0]> = {}) {
  return verifySignature({
    rawBody: BODY,
    header: signatureHeader(BODY, NOW, SECRET),
    secret: SECRET,
    nowSeconds: NOW,
    ...overrides,
  });
}

describe('webhook signature', () => {
  it('verifies a correctly signed request', () => {
    expect(verify()).toEqual({ ok: true, timestampSeconds: NOW });
  });

  it('produces a 64-character hex digest', () => {
    expect(sign(BODY, NOW, SECRET)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('signs the timestamp into the payload, so the header cannot be re-stamped', () => {
    // Negative: a captured signature paired with a bumped timestamp must fail.
    // The MAC covers `NOW.body`, so claiming `NOW+1` changes the signed payload.
    const header = `t=${NOW + 1},v1=${sign(BODY, NOW, SECRET)}`;

    expect(verifySignature({ rawBody: BODY, header, secret: SECRET, nowSeconds: NOW })).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });

  // The point of signing raw bytes: a body that parses identically is a
  // different body, and must not verify.
  it('rejects a body whose bytes changed but whose meaning did not', () => {
    const respaced = `{ "labId": "lab-1", "type": "provision_failed" }`;

    expect(verify({ rawBody: respaced })).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rejects a body signed with a different secret', () => {
    const header = signatureHeader(BODY, NOW, 'other-secret');

    expect(verifySignature({ rawBody: BODY, header, secret: SECRET, nowSeconds: NOW })).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });

  it.each([
    ['missing header', undefined],
    ['empty header', ''],
    ['no key separator', 't1700000000,v1x'],
    ['timestamp only', 't=1700000000'],
    ['signature only', 'v1=ab'],
    ['unknown key', 't=1700000000,v2=ab,extra=1'],
    ['repeated timestamp', 't=1700000000,t=1700000001'],
    ['repeated signature', 't=1700000000,v1=ab,v1=cd'],
    ['short signature', 't=1700000000,v1=abcd'],
    ['non-hex signature', `t=1700000000,v1=${'z'.repeat(64)}`],
  ])('rejects a malformed header (%s)', (_label, header) => {
    expect(verify({ header })).toEqual({ ok: false, reason: 'malformed_header' });
  });

  it.each([
    ['empty', ''],
    ['negative', '-1700000000'],
    ['signed', '+1700000000'],
    ['decimal', '1700000000.5'],
    ['exponent', '1e9'],
    ['non-numeric', 'abcdef'],
  ])('rejects a malformed timestamp (%s)', (_label, timestamp) => {
    expect(verify({ header: `t=${timestamp},v1=${sign(BODY, NOW, SECRET)}` })).toEqual({
      ok: false,
      reason: 'malformed_timestamp',
    });
  });

  // Whitespace around a header value is a sender formatting quirk, not an
  // attack: both forms sign the same parsed timestamp, so leniency is safe.
  it('tolerates whitespace around the header values', () => {
    const header = `t= ${NOW} , v1= ${sign(BODY, NOW, SECRET)} `;

    expect(verifySignature({ rawBody: BODY, header, secret: SECRET, nowSeconds: NOW })).toEqual({
      ok: true,
      timestampSeconds: NOW,
    });
  });

  it('rejects a timestamp that overflows a safe integer', () => {
    const huge = '9'.repeat(30);

    expect(verify({ header: `t=${huge},v1=${sign(BODY, NOW, SECRET)}` })).toEqual({
      ok: false,
      reason: 'malformed_timestamp',
    });
  });

  it('rejects a correctly signed request that has gone stale', () => {
    const stale = signatureHeader(BODY, NOW - DEFAULT_TOLERANCE_SECONDS - 1, SECRET);

    expect(verifySignature({ rawBody: BODY, header: stale, secret: SECRET, nowSeconds: NOW })).toEqual(
      { ok: false, reason: 'timestamp_out_of_window' },
    );
  });

  it('rejects a correctly signed request dated in the future', () => {
    const ahead = signatureHeader(BODY, NOW + DEFAULT_TOLERANCE_SECONDS + 1, SECRET);

    expect(verifySignature({ rawBody: BODY, header: ahead, secret: SECRET, nowSeconds: NOW })).toEqual(
      { ok: false, reason: 'timestamp_out_of_window' },
    );
  });

  it('accepts drift exactly at the tolerance boundary', () => {
    const edge = signatureHeader(BODY, NOW - DEFAULT_TOLERANCE_SECONDS, SECRET);

    expect(verifySignature({ rawBody: BODY, header: edge, secret: SECRET, nowSeconds: NOW })).toEqual({
      ok: true,
      timestampSeconds: NOW - DEFAULT_TOLERANCE_SECONDS,
    });
  });

  // Negative: the skew window must not be a way to pass a wrong signature, and
  // a valid signature must not be able to widen its own window.
  it('still rejects a bad signature inside the tolerance window', () => {
    const header = signatureHeader(BODY, NOW, 'other-secret');

    expect(verifySignature({ rawBody: BODY, header, secret: SECRET, nowSeconds: NOW })).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });

  it('does not let the caller widen the tolerance through the header', () => {
    const veryOld = signatureHeader(BODY, NOW - 86_400, SECRET);

    expect(
      verifySignature({ rawBody: BODY, header: veryOld, secret: SECRET, nowSeconds: NOW }),
    ).toEqual({ ok: false, reason: 'timestamp_out_of_window' });
  });

  it('never leaks the secret through its own output', () => {
    const header = signatureHeader(BODY, NOW, SECRET);

    expect(header).not.toContain(SECRET);
    expect(sign(BODY, NOW, SECRET)).not.toContain(SECRET);
  });
});