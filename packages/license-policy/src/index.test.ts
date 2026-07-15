import { describe, it, expect } from 'vitest';
import {
  KEY_PREFIX,
  GRACE_DAYS,
  DAY_MS,
  base64UrlToBytes,
  bytesToBase64Url,
  decodeSb1Key,
  parsePayload,
  resolvePolicyState,
  isPolicyError,
} from './index.js';
import { GOLDEN_VECTORS } from './golden-vectors.js';

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('constants', () => {
  it('KEY_PREFIX / GRACE_DAYS / DAY_MS match the historical values', () => {
    expect(KEY_PREFIX).toBe('SB1');
    expect(GRACE_DAYS).toBe(7);
    expect(DAY_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe('base64UrlToBytes / bytesToBase64Url', () => {
  it('round-trips arbitrary byte lengths, including ones that need padding', () => {
    for (const len of [0, 1, 2, 3, 4, 5, 16, 33]) {
      const bytes = new Uint8Array(len).map((_, i) => (i * 7 + 1) % 256);
      const encoded = bytesToBase64Url(bytes);
      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('/');
      expect(encoded).not.toContain('=');
      expect(Array.from(base64UrlToBytes(encoded))).toEqual(Array.from(bytes));
    }
  });

  it('decodes a value produced by Buffer/Node base64url tooling identically', () => {
    const bytes = new Uint8Array([1, 2, 3, 250, 251, 252, 253]);
    expect(Array.from(base64UrlToBytes(b64url(bytes)))).toEqual(Array.from(bytes));
  });

  it('throws on invalid base64url input', () => {
    expect(() => base64UrlToBytes('not base64 at all!!')).toThrow();
  });
});

describe('decodeSb1Key', () => {
  it('decodes a well-formed SB1 key into payload/signature byte segments', () => {
    const payloadBytes = new TextEncoder().encode(JSON.stringify({ kind: 'lifetime' }));
    const sigBytes = new Uint8Array([9, 9, 9]);
    const key = `${KEY_PREFIX}.${bytesToBase64Url(payloadBytes)}.${bytesToBase64Url(sigBytes)}`;

    const decoded = decodeSb1Key(key);
    expect(isPolicyError(decoded)).toBe(false);
    if (isPolicyError(decoded)) throw new Error('unreachable');
    expect(Array.from(decoded.payloadBytes)).toEqual(Array.from(payloadBytes));
    expect(Array.from(decoded.sigBytes)).toEqual(Array.from(sigBytes));
  });

  it('trims surrounding whitespace before parsing', () => {
    const payloadBytes = new TextEncoder().encode(JSON.stringify({ kind: 'lifetime' }));
    const sigBytes = new Uint8Array([1]);
    const key = `  ${KEY_PREFIX}.${bytesToBase64Url(payloadBytes)}.${bytesToBase64Url(sigBytes)}  `;
    expect(isPolicyError(decodeSb1Key(key))).toBe(false);
  });

  it('rejects an empty key', () => {
    expect(decodeSb1Key('')).toEqual({ error: 'Empty license key' });
    expect(decodeSb1Key('   ')).toEqual({ error: 'Empty license key' });
  });

  it.each(['garbage', 'SB1.only-two', 'XX9.a.b', 'SB1.a.b.c'])(
    'rejects wrong arity/prefix for %j',
    (key) => {
      expect(decodeSb1Key(key)).toEqual({ error: 'Not a Sound Buddy license key' });
    },
  );

  it('rejects an unparseable base64url segment as a corrupt encoding', () => {
    expect(decodeSb1Key('SB1.not base64!!.also bad!!')).toEqual({ error: 'Corrupt license encoding' });
  });
});

describe('parsePayload', () => {
  it('parses a well-formed JSON object payload', () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ kind: 'lifetime', email: 'a@b.c' }));
    expect(parsePayload(bytes)).toEqual({ kind: 'lifetime', email: 'a@b.c' });
  });

  it.each([
    ['not json', 'not json'],
    ['a bare number', '42'],
    ['a bare string', '"hello"'],
    ['null', 'null'],
    ['an array', '[1,2,3]'],
  ])('rejects %s as a corrupt payload', (_label, json) => {
    const bytes = new TextEncoder().encode(json);
    expect(parsePayload(bytes)).toEqual({ error: 'Corrupt license payload' });
  });
});

describe('isPolicyError', () => {
  it('distinguishes a PolicyError from a real payload/decoded key', () => {
    expect(isPolicyError({ error: 'x' })).toBe(true);
    expect(isPolicyError({ kind: 'lifetime' })).toBe(false);
    expect(isPolicyError(null)).toBe(false);
    expect(isPolicyError(undefined)).toBe(false);
  });
});

describe('resolvePolicyState — golden vectors', () => {
  it.each(GOLDEN_VECTORS)('$label', (vector) => {
    expect(resolvePolicyState(vector.payload, vector.now)).toEqual(vector.expected);
  });
});
