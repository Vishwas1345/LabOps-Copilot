// HMAC-SHA256 over `${timestampSeconds}.${rawBody}`, sent as `t=<ts>,v1=<hex>`.
// The timestamp is inside the MAC and the raw bytes are signed rather than the
// parsed object, so a replayed or rewritten request fails verification. Pure
// crypto with no I/O, so the scheme is testable without an HTTP server.

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Hex digest length of HMAC-SHA256; any other length cannot be a real signature. */
const DIGEST_HEX_LENGTH = 64;

/** How far a signed request's timestamp may drift from ours, in either direction. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

export type SignatureFailure =
  | 'malformed_header'
  | 'malformed_timestamp'
  | 'timestamp_out_of_window'
  | 'mismatch';

export type SignatureResult =
  | { ok: true; timestampSeconds: number }
  | { ok: false; reason: SignatureFailure };

export function sign(rawBody: string, timestampSeconds: number, secret: string): string {
  return createHmac('sha256', secret)
    .update(`${timestampSeconds}.${rawBody}`, 'utf8')
    .digest('hex');
}

/** The header a provider must send: `t=1700000000,v1=ab12...`. */
export function signatureHeader(
  rawBody: string,
  timestampSeconds: number,
  secret: string,
): string {
  return `t=${timestampSeconds},v1=${sign(rawBody, timestampSeconds, secret)}`;
}

function parseHeader(
  header: string,
): { timestamp: string; signature: string } | undefined {
  let timestamp: string | undefined;
  let signature: string | undefined;

  for (const part of header.split(',')) {
    const separator = part.indexOf('=');
    if (separator === -1) return undefined;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    // A repeated key is ambiguous, so it is refused rather than resolved.
    if (key === 't') {
      if (timestamp !== undefined) return undefined;
      timestamp = value;
    } else if (key === 'v1') {
      if (signature !== undefined) return undefined;
      signature = value;
    } else {
      return undefined;
    }
  }

  if (timestamp === undefined || signature === undefined) return undefined;
  return { timestamp, signature };
}

/**
 * Authenticate a delivery. The caller turns every failure into one generic 401,
 * so `reason` is for the audit trail and logs only, never for the response.
 *
 * Order matters: the MAC is checked before the skew window is trusted, because
 * the timestamp is only meaningful once the signature proves we sent it.
 */
export function verifySignature(input: {
  rawBody: string;
  header: string | undefined;
  secret: string;
  nowSeconds: number;
  toleranceSeconds?: number;
}): SignatureResult {
  const { rawBody, header, secret, nowSeconds } = input;
  const toleranceSeconds = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;

  if (!header) return { ok: false, reason: 'malformed_header' };

  const parsed = parseHeader(header);
  if (!parsed) return { ok: false, reason: 'malformed_header' };

  // Digits only: rejects '', '+1', '1e3', ' 12' and '-1' alike.
  if (!/^\d+$/.test(parsed.timestamp)) return { ok: false, reason: 'malformed_timestamp' };
  if (!/^[0-9a-f]{64}$/i.test(parsed.signature)) return { ok: false, reason: 'malformed_header' };

  const timestampSeconds = Number(parsed.timestamp);
  // A 30-digit timestamp is digits but overflows; refuse it rather than wrap.
  if (!Number.isSafeInteger(timestampSeconds)) return { ok: false, reason: 'malformed_timestamp' };

  const expected = Buffer.from(sign(rawBody, timestampSeconds, secret), 'hex');
  const provided = Buffer.from(parsed.signature, 'hex');
  // Both buffers are pinned to 32 bytes by the hex checks above, so this cannot
  // throw on a length mismatch the way timingSafeEqual would otherwise.
  if (!timingSafeEqual(expected, provided)) return { ok: false, reason: 'mismatch' };

  if (Math.abs(nowSeconds - timestampSeconds) > toleranceSeconds) {
    return { ok: false, reason: 'timestamp_out_of_window' };
  }

  return { ok: true, timestampSeconds };
}