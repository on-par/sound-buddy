// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The #ideal-profile-select dropdown + #ideal-curve-edit-btn, portaled onto
// #ideal-profile-island (TD-001 slice 6b, #700) — replaces inline-app.js's
// initIdealProfileSelect/refreshIdealProfileSelect. Renders its icons inline
// (dangerouslySetInnerHTML) rather than via `data-icon` — the portal mounts
// after inline-app's boot-time hydrateIcons(document) pass, so `data-icon`
// would never hydrate (see SpectrumStatus.tsx's note).

import { iconSvg } from './report-card';
import { useStoreShallow } from './stores/useStoreShallow';
import { useIdealProfilesStore } from './stores/idealProfilesStore';
import { profileSelectOptions } from './ideal-profiles';

export default function IdealProfileSelect() {
  const { selectedId, customProfiles } = useStoreShallow(useIdealProfilesStore, (s) => ({
    selectedId: s.selectedId,
    customProfiles: s.customProfiles,
  }));

  const options = profileSelectOptions(customProfiles);
  const builtin = options.filter((o) => o.group === 'builtin');
  const custom = options.filter((o) => o.group === 'custom');
  const action = options.filter((o) => o.group === 'action');

  return (
    <>
      <div className="select-wrap">
        <select
          id="ideal-profile-select"
          aria-label="Ideal EQ profile"
          value={selectedId}
          onChange={(e) => {
            const value = e.target.value;
            // The controlled `value` prop stays `selectedId` below, so picking
            // __new snaps the <select> straight back — same as the old
            // imperative `sel.value = idealProfileId` snap-back.
            if (value === '__new') {
              useIdealProfilesStore.getState().openEditor();
              return;
            }
            void useIdealProfilesStore.getState().select(value);
          }}
        >
          {builtin.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
          {custom.length > 0 && (
            <optgroup label="Custom">
              {custom.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </optgroup>
          )}
          {action.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <span className="select-caret" dangerouslySetInnerHTML={{ __html: iconSvg('chevron-down', 16) }} />
      </div>
      <button
        type="button"
        id="ideal-curve-edit-btn"
        aria-label="Create or edit ideal curve"
        title="Create or edit ideal curve"
        onClick={() => useIdealProfilesStore.getState().openEditor()}
      >
        <span dangerouslySetInnerHTML={{ __html: iconSvg('settings', 15) }} />
      </button>
    </>
  );
}
