import { describe, expect, it } from 'vitest';
import {
  CODESIGN_BATCH_SIZE,
  isMachOBinary,
  parseSpctlAssessment,
  parseStaplerValidation,
  planCodesignBatches,
  resolveSigningConfig,
} from './signing.js';

describe('resolveSigningConfig', () => {
  it('returns signed: true with identity + notaryProfile when both env vars are set', () => {
    const config = resolveSigningConfig({
      SOUND_BUDDY_SIGNING_IDENTITY: 'Developer ID Application: Patrick Robinson (TEAMID)',
      SOUND_BUDDY_NOTARY_PROFILE: 'sound-buddy-notary',
    });
    expect(config).toEqual({
      signed: true,
      identity: 'Developer ID Application: Patrick Robinson (TEAMID)',
      identityName: 'Patrick Robinson (TEAMID)',
      notaryProfile: 'sound-buddy-notary',
    });
  });

  it('returns signed: false when neither env var is set', () => {
    expect(resolveSigningConfig({})).toEqual({ signed: false });
  });

  it('returns signed: false when both env vars are undefined', () => {
    expect(
      resolveSigningConfig({ SOUND_BUDDY_SIGNING_IDENTITY: undefined, SOUND_BUDDY_NOTARY_PROFILE: undefined }),
    ).toEqual({ signed: false });
  });

  it('treats whitespace-only values as unset (both whitespace -> unsigned)', () => {
    expect(
      resolveSigningConfig({ SOUND_BUDDY_SIGNING_IDENTITY: '   ', SOUND_BUDDY_NOTARY_PROFILE: '  \t ' }),
    ).toEqual({ signed: false });
  });

  it('throws naming both variables when only SOUND_BUDDY_SIGNING_IDENTITY is set', () => {
    expect(() =>
      resolveSigningConfig({ SOUND_BUDDY_SIGNING_IDENTITY: 'Developer ID Application: X (TEAMID)' }),
    ).toThrow(/SOUND_BUDDY_SIGNING_IDENTITY.*SOUND_BUDDY_NOTARY_PROFILE|SOUND_BUDDY_NOTARY_PROFILE.*SOUND_BUDDY_SIGNING_IDENTITY/s);
  });

  it('throws naming the missing variable when only SOUND_BUDDY_SIGNING_IDENTITY is set', () => {
    expect(() =>
      resolveSigningConfig({ SOUND_BUDDY_SIGNING_IDENTITY: 'Developer ID Application: X (TEAMID)' }),
    ).toThrow(/SOUND_BUDDY_NOTARY_PROFILE is missing/);
  });

  it('throws naming the missing variable when only SOUND_BUDDY_NOTARY_PROFILE is set', () => {
    expect(() =>
      resolveSigningConfig({ SOUND_BUDDY_NOTARY_PROFILE: 'sound-buddy-notary' }),
    ).toThrow(/SOUND_BUDDY_SIGNING_IDENTITY is missing/);
  });

  it('treats a whitespace-only identity as unset -> single-var error naming identity missing', () => {
    expect(() =>
      resolveSigningConfig({
        SOUND_BUDDY_SIGNING_IDENTITY: '   ',
        SOUND_BUDDY_NOTARY_PROFILE: 'sound-buddy-notary',
      }),
    ).toThrow(/SOUND_BUDDY_SIGNING_IDENTITY is missing/);
  });

  it('treats a whitespace-only notaryProfile as unset -> single-var error naming notaryProfile missing', () => {
    expect(() =>
      resolveSigningConfig({
        SOUND_BUDDY_SIGNING_IDENTITY: 'Developer ID Application: X (TEAMID)',
        SOUND_BUDDY_NOTARY_PROFILE: '   ',
      }),
    ).toThrow(/SOUND_BUDDY_NOTARY_PROFILE is missing/);
  });

  it('error message states both are required to sign, or neither to build unsigned', () => {
    expect(() => resolveSigningConfig({ SOUND_BUDDY_SIGNING_IDENTITY: 'x' })).toThrow(
      /both.*required|either.*or neither/i,
    );
  });

  it('trims surrounding whitespace from valid values', () => {
    const config = resolveSigningConfig({
      SOUND_BUDDY_SIGNING_IDENTITY: '  Developer ID Application: X (TEAMID)  ',
      SOUND_BUDDY_NOTARY_PROFILE: '  sound-buddy-notary  ',
    });
    expect(config).toEqual({
      signed: true,
      identity: 'Developer ID Application: X (TEAMID)',
      identityName: 'X (TEAMID)',
      notaryProfile: 'sound-buddy-notary',
    });
  });

  it('derives both forms from a prefixed identity (AC scenario 1)', () => {
    const config = resolveSigningConfig({
      SOUND_BUDDY_SIGNING_IDENTITY: 'Developer ID Application: On PAR Dev, LLC (Q7LB49TPBS)',
      SOUND_BUDDY_NOTARY_PROFILE: 'sound-buddy-notary',
    });
    expect(config.identity).toBe('Developer ID Application: On PAR Dev, LLC (Q7LB49TPBS)');
    expect(config.identityName).toBe('On PAR Dev, LLC (Q7LB49TPBS)');
  });

  it('reconstructs the full prefixed form from a bare identity (AC scenario 2)', () => {
    const config = resolveSigningConfig({
      SOUND_BUDDY_SIGNING_IDENTITY: 'On PAR Dev, LLC (Q7LB49TPBS)',
      SOUND_BUDDY_NOTARY_PROFILE: 'sound-buddy-notary',
    });
    expect(config.identityName).toBe('On PAR Dev, LLC (Q7LB49TPBS)');
    expect(config.identity).toBe('Developer ID Application: On PAR Dev, LLC (Q7LB49TPBS)');
  });

  it('never carries the Developer ID Application prefix in identityName', () => {
    const config = resolveSigningConfig({
      SOUND_BUDDY_SIGNING_IDENTITY: 'Developer ID Application: On PAR Dev, LLC (Q7LB49TPBS)',
      SOUND_BUDDY_NOTARY_PROFILE: 'sound-buddy-notary',
    });
    expect(config.identityName?.startsWith('Developer ID Application:')).toBe(false);
  });

  it('is idempotent when the derived full identity is fed back in', () => {
    const first = resolveSigningConfig({
      SOUND_BUDDY_SIGNING_IDENTITY: 'On PAR Dev, LLC (Q7LB49TPBS)',
      SOUND_BUDDY_NOTARY_PROFILE: 'sound-buddy-notary',
    });
    const second = resolveSigningConfig({
      SOUND_BUDDY_SIGNING_IDENTITY: first.identity,
      SOUND_BUDDY_NOTARY_PROFILE: 'sound-buddy-notary',
    });
    expect(second.identity).toBe(first.identity);
    expect(second.identityName).toBe(first.identityName);
  });

  it('trims whitespace immediately following the prefix', () => {
    const config = resolveSigningConfig({
      SOUND_BUDDY_SIGNING_IDENTITY: 'Developer ID Application:   X (TEAMID)',
      SOUND_BUDDY_NOTARY_PROFILE: 'sound-buddy-notary',
    });
    expect(config.identityName).toBe('X (TEAMID)');
    expect(config.identity).toBe('Developer ID Application: X (TEAMID)');
  });

  it('does not double-prefix a prefixed identity missing the space after the colon', () => {
    const config = resolveSigningConfig({
      SOUND_BUDDY_SIGNING_IDENTITY: 'Developer ID Application:X (TEAMID)',
      SOUND_BUDDY_NOTARY_PROFILE: 'sound-buddy-notary',
    });
    expect(config.identityName).toBe('X (TEAMID)');
    expect(config.identity).toBe('Developer ID Application: X (TEAMID)');
  });
});

describe('isMachOBinary', () => {
  it.each([
    ['32-bit Mach-O (0xfeedface)', [0xfe, 0xed, 0xfa, 0xce]],
    ['64-bit Mach-O (0xfeedfacf)', [0xfe, 0xed, 0xfa, 0xcf]],
    ['32-bit fat/universal (0xcafebabe)', [0xca, 0xfe, 0xba, 0xbe]],
    ['64-bit fat/universal (0xbebafeca)', [0xbe, 0xba, 0xfe, 0xca]],
    ['byte-swapped 32-bit thin (0xcefaedfe)', [0xce, 0xfa, 0xed, 0xfe]],
    ['byte-swapped 64-bit thin (0xcffaedfe)', [0xcf, 0xfa, 0xed, 0xfe]],
  ])('returns true for %s', (_label, bytes) => {
    expect(isMachOBinary(new Uint8Array(bytes))).toBe(true);
  });

  it('returns true when extra bytes follow the 4-byte magic', () => {
    expect(isMachOBinary(new Uint8Array([0xfe, 0xed, 0xfa, 0xce, 0x00, 0x01, 0x02]))).toBe(true);
  });

  it('returns false for a non-magic 4-byte buffer', () => {
    expect(isMachOBinary(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBe(false);
  });

  it('returns false for a shell script shebang', () => {
    expect(isMachOBinary(new Uint8Array([0x23, 0x21, 0x2f, 0x62]))).toBe(false); // "#!/b"
  });

  it('returns false for input shorter than 4 bytes', () => {
    expect(isMachOBinary(new Uint8Array([0xfe, 0xed, 0xfa]))).toBe(false);
  });

  it('returns false for an empty buffer', () => {
    expect(isMachOBinary(new Uint8Array([]))).toBe(false);
  });
});

describe('parseStaplerValidation', () => {
  it('accepts real success output', () => {
    const output = 'Processing: /x/Sound Buddy.app\nThe validate action worked!';
    expect(parseStaplerValidation(output)).toEqual({ stapled: true });
  });

  it('rejects a missing-ticket failure, quoting the output with an actionable error', () => {
    const output = 'Processing: /x/Sound Buddy.app\nThe validate action failed! Error 65.';
    const verdict = parseStaplerValidation(output);
    expect(verdict.stapled).toBe(false);
    if (verdict.stapled) throw new Error('expected failure');
    expect(verdict.error).toContain(output);
    expect(verdict.error).toMatch(/offline/i);
    expect(verdict.error).toMatch(/APPLE_KEYCHAIN_PROFILE/);
    expect(verdict.error).toMatch(/mac\.notarize/);
  });

  it('rejects empty output with the same actionable error', () => {
    const verdict = parseStaplerValidation('');
    expect(verdict.stapled).toBe(false);
    if (verdict.stapled) throw new Error('expected failure');
    expect(verdict.error).toMatch(/offline/i);
    expect(verdict.error).toMatch(/APPLE_KEYCHAIN_PROFILE/);
    expect(verdict.error).toMatch(/mac\.notarize/);
  });
});

describe('parseSpctlAssessment', () => {
  it('accepts output containing a line ending ": accepted"', () => {
    const output = 'Sound Buddy.app: accepted\nsource=Notarized Developer ID';
    expect(parseSpctlAssessment(output)).toEqual({ accepted: true });
  });

  it('rejects output without an ": accepted" line, quoting the output', () => {
    const output = 'Sound Buddy.app: rejected\nsource=no usable signature';
    const verdict = parseSpctlAssessment(output);
    expect(verdict.accepted).toBe(false);
    if (verdict.accepted) throw new Error('expected rejection');
    expect(verdict.error).toContain(output);
    expect(verdict.error).toMatch(/Gatekeeper/i);
    expect(verdict.error).toMatch(/notariz/i);
    expect(verdict.error).toMatch(/stapl/i);
  });

  it('rejects empty output', () => {
    const verdict = parseSpctlAssessment('');
    expect(verdict.accepted).toBe(false);
    if (verdict.accepted) throw new Error('expected rejection');
    expect(verdict.error).toMatch(/Gatekeeper/i);
  });
});

describe('planCodesignBatches', () => {
  it('returns [] for an empty array', () => {
    expect(planCodesignBatches([])).toEqual([]);
  });

  it('splits 5 paths with batchSize 2 into [[a,b],[c,d],[e]], preserving order', () => {
    const paths = ['a', 'b', 'c', 'd', 'e'];
    expect(planCodesignBatches(paths, 2)).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
  });

  it('produces no trailing empty batch for an exact multiple', () => {
    const paths = ['a', 'b', 'c', 'd'];
    expect(planCodesignBatches(paths, 2)).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('returns a single batch when paths.length < batchSize', () => {
    const paths = ['a', 'b'];
    expect(planCodesignBatches(paths, 10)).toEqual([['a', 'b']]);
  });

  it('flattens back to the input with no path dropped or duplicated (default CODESIGN_BATCH_SIZE)', () => {
    const paths = Array.from({ length: 130 }, (_, i) => `/path/to/binary-${i}`);
    const batches = planCodesignBatches(paths);
    expect(batches.flat()).toEqual(paths);
  });

  it('CODESIGN_BATCH_SIZE is a positive integer', () => {
    expect(Number.isInteger(CODESIGN_BATCH_SIZE)).toBe(true);
    expect(CODESIGN_BATCH_SIZE).toBeGreaterThan(0);
  });

  it.each([0, -1, 1.5])('throws an actionable message for batchSize %s', (batchSize) => {
    expect(() => planCodesignBatches(['a'], batchSize)).toThrow(/positive integer/);
    expect(() => planCodesignBatches(['a'], batchSize)).toThrow(String(batchSize));
  });
});
