// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { sanitize, MAX_SANITIZED_LENGTH, REDACTED } from './sanitize';

const ENV_NAME = 'CLAUDE_CODE_' + 'OAUTH_TOKEN';

describe('sanitize', () => {
  it('redacts the raw token wherever it appears', () => {
    expect(sanitize('auth failed for fake-raw-token-123 (fake-raw-token-123)', ['fake-raw-token-123'])).toBe(`auth failed for ${REDACTED} (${REDACTED})`);
  });

  it('redacts the oauth env var name and any value after it', () => {
    expect(sanitize(`env: ${ENV_NAME}=abc.def-ghi next`)).toBe(`env: ${REDACTED} next`);
    expect(sanitize(`${ENV_NAME}: zzz`)).toBe(REDACTED);
    expect(sanitize(`${ENV_NAME} qqq`)).toBe(REDACTED);
  });

  it('redacts sk-ant- and sk- shaped keys but not words that merely contain sk-', () => {
    expect(sanitize('key sk-ant-api03-AbC_d-9 bad')).toBe(`key ${REDACTED} bad`);
    expect(sanitize('key sk-proj-xyz123 bad')).toBe(`key ${REDACTED} bad`);
    expect(sanitize('disk-full on task-runner')).toBe('disk-full on task-runner');
  });

  it('redacts Bearer credentials in any case', () => {
    expect(sanitize('Authorization: Bearer abc.def')).toBe(`Authorization: Bearer ${REDACTED}`);
    expect(sanitize('authorization: bearer xyz')).toBe(`authorization: Bearer ${REDACTED}`);
  });

  it('ignores blank secrets', () => {
    expect(sanitize('plain text', ['', '   '])).toBe('plain text');
  });

  it('caps the length after redacting, so a cap never splits a token into view', () => {
    const token = 'fake-long-token-value';
    const text = `${'x'.repeat(MAX_SANITIZED_LENGTH - 5)}${token}${'y'.repeat(50)}`;
    const out = sanitize(text, [token]);
    expect(out.length).toBe(MAX_SANITIZED_LENGTH + 1);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toContain('fake-');
  });

  it('turns non-string input into a safe string', () => {
    expect(sanitize(new Error(`boom ${ENV_NAME}=s3cret`))).toBe(`Error: boom ${REDACTED}`);
    expect(sanitize(undefined)).toBe('undefined');
  });
});
