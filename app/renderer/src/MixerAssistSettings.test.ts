// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import MixerAssistSettings, {
  ASSIST_INTRO,
  ASSIST_POSITIONING,
  CLOUD_ROW_COPY,
  FIELD_CLASS,
  LOCAL_ROW_COPY,
  closestField,
  commitAssistField,
  saveAssistToken,
  toggleAssist,
} from './MixerAssistSettings';
import { createSettingsStore, useSettingsStore } from './stores/settingsStore';
import { createMixerAssistStore, useMixerAssistStore } from './stores/mixerAssistStore';
import { createMockSoundBuddy, DEFAULT_MIXER_ASSIST_STATUS } from './mock-sound-buddy';
import { ALL_FEATURE_FLAGS_OFF } from '../../electron/feature-flags';
import type { AppSettings, MixerAssistStatusDto, UpdateSettingsPatch } from '../../electron/ipc/api';

const FAKE_TOKEN = 'fake-settings-token-9999';

const BASE_SETTINGS = { mixerCloudAssistEnabled: false, mixerLocalAssistEnabled: false, mixerCloudAssistBinaryPath: '', mixerLocalAssistEndpoint: '', mixerLocalAssistModel: '' } as AppSettings;

function render(settings: Partial<AppSettings>, status: MixerAssistStatusDto | null, flags = { console: true, mixer: true }, tokenMessage: string | null = null): string {
  useSettingsStore.setState({ settings: { ...BASE_SETTINGS, ...settings }, featureFlags: { ...ALL_FEATURE_FLAGS_OFF, ...flags } });
  useMixerAssistStore.setState({ status, tokenMessage });
  return renderToString(createElement(MixerAssistSettings));
}

afterEach(() => {
  useSettingsStore.setState({ settings: null, featureFlags: ALL_FEATURE_FLAGS_OFF });
  useMixerAssistStore.setState({ status: null, tokenMessage: null });
});

const decode = (html: string) => html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('&amp;', '&');

describe('MixerAssistSettings', () => {
  it('is hidden unless the mixer flag (and its console prerequisite) is on', () => {
    expect(render({}, DEFAULT_MIXER_ASSIST_STATUS, { console: true, mixer: false })).toBe('');
    expect(render({}, DEFAULT_MIXER_ASSIST_STATUS, { console: false, mixer: true })).toBe('');
    expect(render({}, DEFAULT_MIXER_ASSIST_STATUS)).toContain('id="mixer-assist-settings"');
  });

  it('carries the locked positioning phrase and says what each runtime sends and that audio is never sent', () => {
    const html = decode(render({}, DEFAULT_MIXER_ASSIST_STATUS));
    expect(ASSIST_INTRO.startsWith(ASSIST_POSITIONING)).toBe(true);
    expect(html).toContain('Works with the AI you already have');
    expect(html).toContain(CLOUD_ROW_COPY);
    expect(html).toContain(LOCAL_ROW_COPY);
    expect(CLOUD_ROW_COPY).toMatch(/channel names.*levels.*your question.*Audio is never sent\./);
    expect(LOCAL_ROW_COPY).toContain('Audio is never sent.');
  });

  it('both toggles off by default; token Not set; live status lines say off', () => {
    const html = decode(render({}, DEFAULT_MIXER_ASSIST_STATUS));
    expect(html).toMatch(/<input type="checkbox" id="mixer-cloud-assist-toggle" readOnly=""\/>/);
    expect(html).toMatch(/<input type="checkbox" id="mixer-local-assist-toggle" readOnly=""\/>/);
    expect(html).toContain('<span class="mx-assist-hint" id="mixer-cloud-token-status">Not set</span>');
    expect(html).toContain('Cloud assist is off.');
    expect(html).toContain('Local assist is off.');
    expect(html).not.toContain('mixer-cloud-token-clear');
  });

  it('Cloud on with a saved token shows Token saved, a Clear button, checked toggles, and the filled Local fields', () => {
    const status: MixerAssistStatusDto = {
      cloud: { enabled: true, binaryFound: true, tokenSaved: true, encryptionAvailable: true, lastFailure: null },
      local: { enabled: true, endpoint: 'ok', modelSet: true, lastFailure: null },
      inFlight: false,
    };
    const html = decode(
      render({ mixerCloudAssistEnabled: true, mixerLocalAssistEnabled: true, mixerLocalAssistEndpoint: 'http://127.0.0.1:8080/v1', mixerLocalAssistModel: 'qwen2.5' }, status)
    );
    expect(html).toContain('id="mixer-cloud-assist-toggle" readOnly="" checked=""');
    expect(html).toContain('id="mixer-local-assist-toggle" readOnly="" checked=""');
    expect(html).toContain('id="mixer-cloud-token-status">Token saved</span>');
    expect(html).toContain('id="mixer-cloud-token-clear"');
    expect(html).toContain('value="http://127.0.0.1:8080/v1"');
    expect(html).toContain('value="qwen2.5"');
    expect(html).toContain('Cloud assist is ready: Claude Code found, token saved.');
    expect(html).toContain('Local assist is ready: http://127.0.0.1:8080/v1.');
    expect(html).toContain('id="mixer-cloud-binary-status">Claude Code found</span>');
  });

  it('the token field is a masked, write-only input: it never renders a value', () => {
    const html = render({ mixerCloudAssistEnabled: true }, { ...DEFAULT_MIXER_ASSIST_STATUS, cloud: { ...DEFAULT_MIXER_ASSIST_STATUS.cloud, tokenSaved: true } });
    const input = html.slice(html.indexOf('<input type="password"'), html.indexOf('/>', html.indexOf('<input type="password"')));
    expect(input).toContain('id="mixer-cloud-token"');
    expect(input).not.toContain('value=');
  });

  it('shows a refused-save message from main', () => {
    expect(decode(render({}, DEFAULT_MIXER_ASSIST_STATUS, undefined, "This Mac can't encrypt the token right now"))).toContain(
      `id="mixer-cloud-token-message" role="status">This Mac can't encrypt the token right now`
    );
  });

  it('shows Checking while the status has not loaded', () => {
    expect(render({}, null)).toContain('Checking Cloud assist');
  });
});

describe('Settings assist actions', () => {
  function input(value: string) {
    return { value };
  }

  it('closestField finds the enclosing field container', () => {
    const container = { querySelector: () => null };
    const seen: string[] = [];
    expect(closestField({ closest: (sel: string) => (seen.push(sel), container) })).toBe(container);
    expect(seen).toEqual([`.${FIELD_CLASS}`]);
  });

  it('saveAssistToken sends the typed token once, then empties the field', async () => {
    const bridge = createMockSoundBuddy();
    const store = createMixerAssistStore({ getApi: () => bridge.api, context: () => ({ channels: [], meters: [], visible: [], issues: [], inspected: null, sermonQuiet: false }), labelFor: () => '' });
    const field = input(FAKE_TOKEN);
    await saveAssistToken({ querySelector: () => field }, store);
    expect(field.value).toBe('');
    expect(bridge.calls.filter((c) => c.method === 'setMixerAssistToken').map((c) => c.args)).toEqual([[FAKE_TOKEN]]);
    expect(JSON.stringify(store.getState())).not.toContain(FAKE_TOKEN);
    await saveAssistToken(null, store);
    await saveAssistToken({ querySelector: () => null }, store);
    expect(bridge.calls.filter((c) => c.method === 'setMixerAssistToken')).toHaveLength(1);
  });

  it('commitAssistField persists the trimmed field value under its own key only', async () => {
    const patches: UpdateSettingsPatch[] = [];
    const store = createSettingsStore(() => ({
      ...createMockSoundBuddy().api,
      updateSettings: (patch: UpdateSettingsPatch) => {
        patches.push(patch);
        return Promise.resolve({ ...BASE_SETTINGS, ...patch } as AppSettings);
      },
    }));
    await commitAssistField({ querySelector: () => input('  http://192.168.1.5:8080/v1 ') }, 'mixerLocalAssistEndpoint', store);
    await commitAssistField(null, 'mixerLocalAssistModel', store);
    await toggleAssist('mixerCloudAssistEnabled', true, store);
    expect(patches).toEqual([{ mixerLocalAssistEndpoint: 'http://192.168.1.5:8080/v1' }, { mixerCloudAssistEnabled: true }]);
  });
});
