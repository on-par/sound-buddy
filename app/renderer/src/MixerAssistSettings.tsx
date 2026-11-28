// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import type { JSX } from 'react';
import type { StoreApi, UseBoundStore } from 'zustand';
import { useStoreShallow } from './stores/useStoreShallow';
import { useSettingsStore, type SettingsState } from './stores/settingsStore';
import { useMixerAssistStore, type MixerAssistState } from './stores/mixerAssistStore';
import { isModeFlagEnabled } from './simple-mode';
import { settingsStatusLines } from './mixer/assist-view';
import { MIXER_ASSIST_BINARY_PATH_MAX_LEN, MIXER_ASSIST_ENDPOINT_MAX_LEN, MIXER_ASSIST_MODEL_MAX_LEN, type MixerAssistStatusDto } from '../../electron/ipc/api';

export const ASSIST_POSITIONING = 'Works with the AI you already have';
export const ASSIST_INTRO = `${ASSIST_POSITIONING}: your own Claude Code login, or a model server on this Mac or your local network. Sound Buddy never pays for or relays these requests. Both are off until you turn one on.`;
export const CLOUD_ROW_COPY =
  'Cloud assist sends channel names and numbers, fader and meter levels, compressor settings, the rule note and your question to Claude, through the Claude Code you installed. Audio is never sent.';
export const LOCAL_ROW_COPY =
  'Local assist sends the same channel readings and your question to a model server on this Mac or your local network. Audio is never sent.';
export const TOKEN_HELP = 'Run claude setup-token in Terminal and paste the token here. It is encrypted on this Mac and never shown again.';
export const LOGIN_COPY = 'Cloud assist uses your own Claude Code login on this Mac. Sound Buddy never asks for, sees or stores it. To sign in, run claude in Terminal.';
export const STORED_TOKEN_NOTICE =
  "Sound Buddy no longer stores a Claude Code token. Cloud assist now uses Claude Code's own login on this Mac, and the token you saved earlier is not used. Remove it from this Mac when you're ready.";
export const REMOVE_STORED_TOKEN_LABEL = 'Remove stored token';
export const FIELD_CLASS = 'mx-assist-field';

type AssistTextKey = 'mixerCloudAssistBinaryPath' | 'mixerLocalAssistEndpoint' | 'mixerLocalAssistModel';
type AssistToggleKey = 'mixerCloudAssistEnabled' | 'mixerLocalAssistEnabled';

export interface FieldContainer {
  querySelector(selector: string): { value: string } | null;
}

export function closestField(target: { closest(selector: string): unknown }): FieldContainer | null {
  return target.closest(`.${FIELD_CLASS}`) as FieldContainer | null;
}

export async function saveAssistToken(container: FieldContainer | null, store: UseBoundStore<StoreApi<MixerAssistState>> = useMixerAssistStore): Promise<void> {
  const input = container?.querySelector('input');
  if (!input) return;
  const token = input.value;
  input.value = '';
  await store.getState().saveToken(token);
}

export async function commitAssistField(
  container: FieldContainer | null,
  key: AssistTextKey,
  store: UseBoundStore<StoreApi<SettingsState>> = useSettingsStore
): Promise<void> {
  const input = container?.querySelector('input');
  if (!input) return;
  await store.getState().updateSettings({ [key]: input.value.trim() });
}

export async function toggleAssist(key: AssistToggleKey, on: boolean, store: UseBoundStore<StoreApi<SettingsState>> = useSettingsStore): Promise<void> {
  await store.getState().updateSettings({ [key]: on });
}

function TextField({ id, label, settingKey, value, placeholder, maxLength, status }: {
  id: string;
  label: string;
  settingKey: AssistTextKey;
  value: string;
  placeholder: string;
  maxLength: number;
  status?: string;
}): JSX.Element {
  return (
    <div className={`ai-field ${FIELD_CLASS}`}>
      <label className="ai-field-label" htmlFor={id}>
        {label}
      </label>
      <div className="mx-assist-control">
        <input key={value} type="text" id={id} className="rig-dialog-input" defaultValue={value} placeholder={placeholder} maxLength={maxLength} autoComplete="off" spellCheck={false} />
        <button
          type="button"
          className="btn btn-secondary sm"
          id={`${id}-save`}
          /* c8 ignore next -- click dispatch, no jsdom */
          onClick={(e) => void commitAssistField(closestField(e.currentTarget), settingKey)}
        >
          Save
        </button>
      </div>
      {status !== undefined && <span className="mx-assist-hint" id={`${id}-status`}>{status}</span>}
    </div>
  );
}

function TokenField({ status, tokenMessage, tokenLine }: { status: MixerAssistStatusDto | null; tokenMessage: string | null; tokenLine: string }): JSX.Element {
  return (
    <>
      <div className={`ai-field ${FIELD_CLASS}`}>
        <label className="ai-field-label" htmlFor="mixer-cloud-token">
          Claude Code token
        </label>
        <div className="mx-assist-control">
          <input type="password" id="mixer-cloud-token" className="rig-dialog-input" placeholder="Paste token" autoComplete="off" spellCheck={false} />
          <button
            type="button"
            className="btn btn-secondary sm"
            id="mixer-cloud-token-save"
            /* c8 ignore next -- click dispatch, no jsdom */
            onClick={(e) => void saveAssistToken(closestField(e.currentTarget))}
          >
            Save
          </button>
          {status?.cloud.tokenSaved && (
            <button
              type="button"
              className="btn btn-ghost sm"
              id="mixer-cloud-token-clear"
              /* c8 ignore next -- click dispatch, no jsdom */
              onClick={() => void useMixerAssistStore.getState().clearToken()}
            >
              Clear
            </button>
          )}
        </div>
        <span className={`mx-assist-hint${status?.cloud.tokenSaved ? ' mx-assist-good' : ''}`} id="mixer-cloud-token-status">
          {tokenLine}
        </span>
      </div>
      <p className="ai-dialog-note">{TOKEN_HELP}</p>
      {tokenMessage !== null && (
        <p className="ai-dialog-note mx-assist-warn" id="mixer-cloud-token-message" role="status">
          {tokenMessage}
        </p>
      )}
    </>
  );
}

function LoginNote({ storedToken }: { storedToken: boolean }): JSX.Element {
  return (
    <>
      <p className="ai-dialog-note" id="mixer-cloud-login-copy">
        {LOGIN_COPY}
      </p>
      {storedToken && (
        <div className="mx-assist-notice">
          <p className="ai-dialog-note mx-assist-warn" id="mixer-cloud-stored-token-notice" role="status">
            {STORED_TOKEN_NOTICE}
          </p>
          <button
            type="button"
            className="btn btn-secondary sm"
            id="mixer-cloud-stored-token-remove"
            /* c8 ignore next -- click dispatch, no jsdom */
            onClick={() => void useMixerAssistStore.getState().clearToken()}
          >
            {REMOVE_STORED_TOKEN_LABEL}
          </button>
        </div>
      )}
    </>
  );
}

export default function MixerAssistSettings(): JSX.Element | null {
  const { settings, featureFlags } = useStoreShallow(useSettingsStore, (s) => ({ settings: s.settings, featureFlags: s.featureFlags }));
  const { status, tokenMessage } = useStoreShallow(useMixerAssistStore, (s) => ({ status: s.status, tokenMessage: s.tokenMessage }));
  if (!isModeFlagEnabled('mixer', featureFlags)) return null;

  const cloudOn = settings?.mixerCloudAssistEnabled === true;
  const localOn = settings?.mixerLocalAssistEnabled === true;
  const endpoint = settings?.mixerLocalAssistEndpoint ?? '';
  const lines = settingsStatusLines(status, endpoint);

  return (
    <section className="settings-group mx-assist-settings" id="mixer-assist-settings">
      <h3 className="settings-group-title">Mixer assist</h3>
      <p className="ai-dialog-note" id="mixer-assist-intro">
        {ASSIST_INTRO}
      </p>
      <label className="ai-enable-row">
        <span className="settings-row-label">Cloud assist</span>
        <input
          type="checkbox"
          id="mixer-cloud-assist-toggle"
          checked={cloudOn}
          readOnly
          /* c8 ignore next -- click dispatch, no jsdom */
          onClick={() => void toggleAssist('mixerCloudAssistEnabled', !cloudOn)}
        />
      </label>
      <p className="ai-dialog-note" id="mixer-cloud-assist-copy">
        {CLOUD_ROW_COPY}
      </p>
      {featureFlags.mixerCloudAssistLogin ? (
        <LoginNote storedToken={status?.cloud.storedToken === true} />
      ) : (
        <TokenField status={status} tokenMessage={tokenMessage} tokenLine={lines.token} />
      )}
      <TextField
        id="mixer-cloud-binary"
        label="Claude Code path"
        settingKey="mixerCloudAssistBinaryPath"
        value={settings?.mixerCloudAssistBinaryPath ?? ''}
        placeholder="Blank: look on PATH, ~/.local/bin, Homebrew"
        maxLength={MIXER_ASSIST_BINARY_PATH_MAX_LEN}
        status={lines.binary}
      />
      <label className="ai-enable-row">
        <span className="settings-row-label">Local assist</span>
        <input
          type="checkbox"
          id="mixer-local-assist-toggle"
          checked={localOn}
          readOnly
          /* c8 ignore next -- click dispatch, no jsdom */
          onClick={() => void toggleAssist('mixerLocalAssistEnabled', !localOn)}
        />
      </label>
      <p className="ai-dialog-note" id="mixer-local-assist-copy">
        {LOCAL_ROW_COPY}
      </p>
      <TextField
        id="mixer-local-endpoint"
        label="Local endpoint URL"
        settingKey="mixerLocalAssistEndpoint"
        value={endpoint}
        placeholder="http://127.0.0.1:8080/v1"
        maxLength={MIXER_ASSIST_ENDPOINT_MAX_LEN}
      />
      <TextField
        id="mixer-local-model"
        label="Model name"
        settingKey="mixerLocalAssistModel"
        value={settings?.mixerLocalAssistModel ?? ''}
        placeholder="The model name your server expects"
        maxLength={MIXER_ASSIST_MODEL_MAX_LEN}
      />
      <div className="mx-assist-status" id="mixer-assist-status" role="status">
        <p id="mixer-assist-status-cloud">{lines.cloud}</p>
        <p id="mixer-assist-status-local">{lines.local}</p>
      </div>
    </section>
  );
}
