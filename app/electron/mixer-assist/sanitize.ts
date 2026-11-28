// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

export const MAX_SANITIZED_LENGTH = 400;
export const REDACTED = '[redacted]';
const ELLIPSIS = '…';

const OAUTH_ENV_PATTERN = /CLAUDE_CODE_OAUTH_TOKEN(?:\s*[=:]\s*|\s+)?\S*/g;
const ANTHROPIC_KEY_PATTERN = /\bsk-ant-[\w-]+/g;
const SECRET_KEY_PATTERN = /\bsk-[\w-]+/g;
const BEARER_PATTERN = /\bBearer\s+\S+/gi;

export function redact(input: unknown, secrets: readonly string[] = []): string {
  let text = String(input);
  for (const secret of secrets) {
    const trimmed = secret.trim();
    if (trimmed !== '') text = text.split(trimmed).join(REDACTED);
  }
  return text
    .replace(OAUTH_ENV_PATTERN, REDACTED)
    .replace(ANTHROPIC_KEY_PATTERN, REDACTED)
    .replace(SECRET_KEY_PATTERN, REDACTED)
    .replace(BEARER_PATTERN, `Bearer ${REDACTED}`);
}

export function sanitize(input: unknown, secrets: readonly string[] = []): string {
  const text = redact(input, secrets);
  return text.length > MAX_SANITIZED_LENGTH ? `${text.slice(0, MAX_SANITIZED_LENGTH)}${ELLIPSIS}` : text;
}
