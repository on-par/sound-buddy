import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Point Electron's userData at a per-test temp dir (same harness pattern as
// settings.test.ts) and stub safeStorage with a reversible fake cipher so we
// can assert "never plaintext on disk" without the real Keychain.
let userDataDir = '';
let encryptionAvailable = true;
vi.mock('electron', () => ({
  app: { getPath: () => userDataDir },
  BrowserWindow: class {},
  safeStorage: {
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: (s: string) => Buffer.from(`enc:${s}`, 'utf8'),
    decryptString: (b: Buffer) => {
      const s = b.toString('utf8');
      if (!s.startsWith('enc:')) throw new Error('bad ciphertext');
      return s.slice(4);
    },
  },
}));

import {
  getLlmConfig,
  getPublicLlmConfig,
  saveLlmConfig,
  getApiKey,
  DEFAULT_OLLAMA_HOST,
} from './llm-config';

const llmFile = () => path.join(userDataDir, 'llm.json');
const readFile = () => JSON.parse(fs.readFileSync(llmFile(), 'utf8'));
const writeFile = (obj: unknown) => fs.writeFileSync(llmFile(), JSON.stringify(obj, null, 2));

const LLM_ENV_VARS = [
  'SOUND_BUDDY_LLM_PROVIDER',
  'SOUND_BUDDY_LLM_MODEL',
  'SOUND_BUDDY_OLLAMA_HOST',
  'SOUND_BUDDY_LLM_BASE_URL',
  'SOUND_BUDDY_LLM_API_KEY',
  'SOUND_BUDDY_PI_BIN',
];

beforeEach(() => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-llm-'));
  encryptionAvailable = true;
  for (const v of LLM_ENV_VARS) delete process.env[v];
});

afterEach(() => {
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

describe('getPublicLlmConfig defaults', () => {
  it('returns empty provider/model, the default Ollama host, and hasApiKey=false with no llm.json', () => {
    expect(getPublicLlmConfig()).toEqual({
      provider: '',
      model: '',
      ollamaHost: DEFAULT_OLLAMA_HOST,
      apiBaseUrl: '',
      hasApiKey: false,
    });
  });
});

describe('saveLlmConfig', () => {
  it('persists provider/model/host and reports them back', () => {
    const pub = saveLlmConfig({ provider: 'ollama', model: 'llama3.2', ollamaHost: 'http://box:11434' });
    expect(pub).toMatchObject({ provider: 'ollama', model: 'llama3.2', ollamaHost: 'http://box:11434' });
    expect(readFile()).toMatchObject({ provider: 'ollama', model: 'llama3.2' });
  });

  it('normalizes a blank ollamaHost back to the default', () => {
    expect(saveLlmConfig({ ollamaHost: '   ' }).ollamaHost).toBe(DEFAULT_OLLAMA_HOST);
  });

  it('stores the API key only as ciphertext — the plaintext never touches disk', () => {
    saveLlmConfig({ provider: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'sk-ant-secret' });
    const raw = fs.readFileSync(llmFile(), 'utf8');
    expect(raw).not.toContain('sk-ant-secret');
    expect(readFile().apiKeyEnc).toBe(Buffer.from('enc:sk-ant-secret').toString('base64'));
    expect(getPublicLlmConfig().hasApiKey).toBe(true);
    expect(getApiKey()).toBe('sk-ant-secret');
  });

  it('keeps the stored key when the patch omits apiKey, clears it on empty string', () => {
    saveLlmConfig({ provider: 'openai', apiKey: 'sk-live' });
    saveLlmConfig({ provider: 'openai', model: 'gpt-4o-mini' }); // no apiKey field
    expect(getApiKey()).toBe('sk-live');
    saveLlmConfig({ apiKey: '' });
    expect(getApiKey()).toBeUndefined();
    expect(readFile().apiKeyEnc).toBeUndefined();
  });

  it('throws (and does not write a key) when OS encryption is unavailable', () => {
    encryptionAvailable = false;
    expect(() => saveLlmConfig({ apiKey: 'sk-live' })).toThrow(/Secure key storage/);
    expect(fs.existsSync(llmFile())).toBe(false);
  });

  it('preserves unknown top-level keys across a save (forward compat)', () => {
    writeFile({ provider: 'ollama', futureKey: 'keep-me' });
    saveLlmConfig({ model: 'llama3.2' });
    expect(readFile().futureKey).toBe('keep-me');
  });
});

describe('env layering', () => {
  it('env overrides apply at read time', () => {
    writeFile({ provider: 'ollama', model: 'llama3.2' });
    process.env.SOUND_BUDDY_LLM_PROVIDER = 'anthropic';
    process.env.SOUND_BUDDY_LLM_MODEL = 'claude-sonnet-4-6';
    const cfg = getLlmConfig();
    expect(cfg.provider).toBe('anthropic');
    expect(cfg.model).toBe('claude-sonnet-4-6');
  });

  it('never bakes an env override into a save', () => {
    writeFile({ provider: 'ollama' });
    process.env.SOUND_BUDDY_LLM_PROVIDER = 'anthropic';
    saveLlmConfig({ model: 'llama3.2' });
    expect(readFile().provider).toBe('ollama');
  });

  it('SOUND_BUDDY_LLM_API_KEY wins over the stored key and flips hasApiKey', () => {
    process.env.SOUND_BUDDY_LLM_API_KEY = 'sk-env';
    expect(getApiKey()).toBe('sk-env');
    expect(getPublicLlmConfig().hasApiKey).toBe(true);
  });
});

describe('robustness', () => {
  it('treats a corrupted llm.json as empty', () => {
    fs.writeFileSync(llmFile(), '{not json');
    expect(getPublicLlmConfig().provider).toBe('');
  });

  it('returns undefined (not a throw) when the ciphertext cannot be decrypted', () => {
    writeFile({ apiKeyEnc: Buffer.from('garbage').toString('base64') });
    expect(getApiKey()).toBeUndefined();
  });
});
