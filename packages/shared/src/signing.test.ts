import { describe, expect, it } from 'vitest';
import {
  isMachOBinary,
  parseNotarySubmission,
  parseSpctlAssessment,
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

describe('parseNotarySubmission', () => {
  it('returns ok: true with id and status for an Accepted submission', () => {
    const json = JSON.stringify({ id: 'abc-123', status: 'Accepted', message: 'done' });
    const result = parseNotarySubmission(json, 'sound-buddy-notary');
    expect(result).toEqual({ ok: true, id: 'abc-123', status: 'Accepted' });
  });

  it('returns ok: false with an actionable notarytool log hint for an Invalid status', () => {
    const json = JSON.stringify({ id: 'abc-123', status: 'Invalid', message: 'failed' });
    const result = parseNotarySubmission(json, 'sound-buddy-notary');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toContain('Invalid');
    expect(result.error).toContain('abc-123');
    expect(result.error).toContain('xcrun notarytool log abc-123 --keychain-profile sound-buddy-notary');
  });

  it('returns ok: false with the log hint for a Rejected status', () => {
    const json = JSON.stringify({ id: 'xyz-789', status: 'Rejected' });
    const result = parseNotarySubmission(json, 'sound-buddy-notary');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toContain('Rejected');
    expect(result.error).toContain('xyz-789');
    expect(result.error).toContain('xcrun notarytool log xyz-789 --keychain-profile sound-buddy-notary');
  });

  it('returns ok: false with a manual re-run hint for garbage JSON', () => {
    const result = parseNotarySubmission('not json{', 'sound-buddy-notary');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toContain('xcrun notarytool submit');
    expect(result.error).toMatch(/credentials/i);
  });

  it('returns ok: false with a manual re-run hint for empty input', () => {
    const result = parseNotarySubmission('', 'sound-buddy-notary');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toContain('xcrun notarytool submit');
  });

  it('falls back to "unknown"/placeholder id in the error when valid JSON omits status and id', () => {
    const result = parseNotarySubmission('{}', 'sound-buddy-notary');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toContain('status: unknown');
    expect(result.error).toContain('submission unknown');
    expect(result.error).toContain('xcrun notarytool log <submission-id> --keychain-profile sound-buddy-notary');
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
