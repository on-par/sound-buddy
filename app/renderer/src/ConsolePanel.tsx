// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The Live tab's first console-facing surface (#884, #848): scan the network
// for an M32R, list what answered, and show the selected console's identity
// (name, model, firmware, IP), with a manual-IP fallback labelled as the
// secondary path. Portaled by App.tsx onto #console-panel-island inside
// #tab-live. Every network action routes through consoleStore, which gates
// on useConsoleNetworkConsentStore's requestConsent() (Tier 2, ADR-0006) —
// per ADR-0006, the consent modal itself (not this panel) is the only path
// that ever grants consent; this panel only requests it.
//
// READ-ONLY BY CONSTRUCTION (#884, #977 ADR): every control here maps to one
// of a handful of read actions — scan, select a found console, submit a
// manual IP, or watch/stop watching live channel state — none of which write
// to the console. The live channel rows themselves are display-only (plain
// <span>s, no input/button/handler). console-read-only-gate.test.ts pins this.

import type { JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useConsoleStore } from './stores/consoleStore';
import { useLiveCaptureStore } from './stores/liveCaptureStore';

const FADER_DB_DECIMALS = 1;

/** Fader position in engineering units (R1b). The console's "-oo" arrives as
 *  -Infinity and reads as the fader being all the way down. */
export function formatFaderDb(db: number): string {
  if (!Number.isFinite(db)) return '-∞ dB';
  return `${db.toFixed(FADER_DB_DECIMALS)} dB`;
}

export default function ConsolePanel(): JSX.Element | null {
  const appMode = useStoreShallow(useLiveCaptureStore, (s) => s.appMode);
  const s = useStoreShallow(useConsoleStore, (st) => ({
    scanStatus: st.scanStatus,
    found: st.found,
    scanError: st.scanError,
    selectedIp: st.selectedIp,
    identity: st.identity,
    identitySource: st.identitySource,
    identityStatus: st.identityStatus,
    identityError: st.identityError,
    manualIp: st.manualIp,
    liveChannels: st.liveChannels,
    liveStateStatus: st.liveStateStatus,
    liveStateError: st.liveStateError,
  }));

  if (appMode !== 'live') return null;

  return (
    <div className="console-panel">
      <h3 id="console-panel-title">Console</h3>
      <button
        type="button"
        id="console-scan"
        className="btn btn-secondary"
        disabled={s.scanStatus === 'scanning'}
        /* c8 ignore next -- click dispatch, no jsdom */
        onClick={() => void useConsoleStore.getState().scan()}
      >
        {s.scanStatus === 'scanning' ? 'Scanning…' : 'Scan for console'}
      </button>

      {s.scanError && (
        <p id="console-scan-error" role="alert">
          {s.scanError}
        </p>
      )}

      {s.scanStatus === 'done' && s.found.length === 0 ? (
        <p id="console-scan-empty">No console answered the scan — enter its IP manually below.</p>
      ) : (
        <ul id="console-found">
          {s.found.map((c) => (
            <li key={c.ip}>
              <button
                type="button"
                data-console-ip={c.ip}
                aria-current={c.ip === s.selectedIp ? true : undefined}
                /* c8 ignore next -- click dispatch, no jsdom */
                onClick={() => void useConsoleStore.getState().selectConsole(c.ip)}
              >
                {c.model} · {c.ip}
              </button>
            </li>
          ))}
        </ul>
      )}

      {s.identityStatus === 'loading' && <p id="console-identity-loading">Reading console identity…</p>}
      {s.identityStatus === 'error' && (
        <p id="console-identity-error" role="alert">
          {s.identityError}
        </p>
      )}
      {s.identityStatus === 'loaded' && s.identity && (
        <>
          {s.identitySource === 'manual' && (
            <span id="console-identity-source" className="console-secondary-tag">
              Secondary — manual entry. Scanning is the primary way to find a console.
            </span>
          )}
          <dl id="console-identity">
            <dt>Name</dt>
            <dd>{s.identity.name ?? '—'}</dd>
            <dt>Model</dt>
            <dd>{s.identity.model}</dd>
            <dt>Firmware</dt>
            <dd>{s.identity.firmware}</dd>
            <dt>IP</dt>
            <dd>{s.identity.ip}</dd>
          </dl>
        </>
      )}

      <button
        type="button"
        id="console-live-toggle"
        className="btn btn-secondary"
        disabled={!s.selectedIp}
        /* c8 ignore next 4 -- click dispatch, no jsdom */
        onClick={() =>
          s.liveStateStatus === 'watching' || s.liveStateStatus === 'starting'
            ? void useConsoleStore.getState().stopLiveState()
            : void useConsoleStore.getState().startLiveState()
        }
      >
        {s.liveStateStatus === 'watching' || s.liveStateStatus === 'starting' ? 'Stop watching' : 'Watch channel state'}
      </button>

      {s.liveStateError && (
        <p id="console-live-error" role="alert">
          {s.liveStateError}
        </p>
      )}

      {s.liveStateStatus === 'starting' && s.liveChannels.length === 0 && (
        <p id="console-live-waiting">Reading channel state…</p>
      )}

      {s.liveChannels.length > 0 && (
        <ul id="console-live-channels">
          {s.liveChannels.map((c) => (
            <li key={c.index} data-channel-index={c.index} className="console-channel-row">
              <span className="console-channel-name">{c.name === '' ? `Ch ${c.index}` : c.name}</span>
              <span className="console-channel-fader">{formatFaderDb(c.faderDb)}</span>
              <span className={c.on ? 'console-channel-on' : 'console-channel-off'}>{c.on ? 'ON' : 'OFF'}</span>
            </li>
          ))}
        </ul>
      )}

      <label htmlFor="console-manual-ip">Console IP (fallback)</label>
      <p>Use this when the scan finds nothing — a different subnet or a blocked broadcast. Scanning is the primary path.</p>
      <input
        id="console-manual-ip"
        type="text"
        value={s.manualIp}
        /* c8 ignore next -- change dispatch, no jsdom */
        onChange={(e) => useConsoleStore.getState().setManualIp(e.target.value)}
      />
      <button
        type="button"
        id="console-manual-submit"
        className="btn btn-secondary"
        disabled={s.manualIp.trim() === ''}
        /* c8 ignore next -- click dispatch, no jsdom */
        onClick={() => void useConsoleStore.getState().submitManualIp()}
      >
        Use this IP
      </button>

      <p className="console-readonly-note">Sound Buddy only reads from the console — it never changes console settings.</p>
    </div>
  );
}
