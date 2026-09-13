// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Settings ▸ Grading: the ideal-curve picker (the baseline every band rule
// grades against) and the editable rubric — one number input per graded
// threshold, showing the active strictness profile's default until the user
// overrides it. Values persist as settings.gradingRubric (absolute overrides
// layered over the profile) and reach grading.js through the bridge's
// settings subscription, so a change re-grades the card on screen at once.
// Pure derivations live in grading-rubric.ts; this file is the wiring.

import { useState } from 'react';
import type { GradingRubricKey } from '../../electron/ipc/api';
import { iconSvg } from './report-card';
import type { SettingsHelpHandlers } from './settings-help';
import { useStoreShallow } from './stores/useStoreShallow';
import { useSettingsStore } from './stores/settingsStore';
import { useIdealProfilesStore } from './stores/idealProfilesStore';
import { profileSelectOptions } from './ideal-profiles';
import {
  RUBRIC_FIELDS,
  RUBRIC_GROUP_LABELS,
  rubricDefaultsFor,
  rubricFieldValue,
  rubricPatchFor,
  isOverridden,
  overrideCount,
  rubricInputId,
  rubricBounds,
  isCommittableDraft,
  type RubricGroup,
} from './grading-rubric';

interface RubricGradingApi {
  rubricDefaults(profileId: string): Record<string, number>;
}
// grading.js is a classic script on window; absent (a bare render with no
// boot scripts) the defaults simply read as unknown rather than throwing.
function getRubricGrading(): RubricGradingApi | null {
  const g = (window as unknown as { grading?: Partial<RubricGradingApi> }).grading;
  return g && typeof g.rubricDefaults === 'function' ? (g as RubricGradingApi) : null;
}

export const RUBRIC_GROUP_ORDER: readonly RubricGroup[] = ['level', 'dynamics', 'balance', 'tone', 'symptoms'];

export interface GradingRubricEditorProps {
  /** Settings help-strip hover/focus handlers for the curve picker and the threshold grid (SettingsPanel's helpFor). */
  baselineHelp?: SettingsHelpHandlers;
  rubricHelp?: SettingsHelpHandlers;
}

export default function GradingRubricEditor({ baselineHelp, rubricHelp }: GradingRubricEditorProps) {
  const { settings } = useStoreShallow(useSettingsStore, (s) => ({ settings: s.settings }));
  // Per-field draft text while the user is typing. A controlled number input
  // fed straight from persisted settings cannot take a partial "-" or an
  // emptied field (the async settings round-trip snaps it back), and every
  // intermediate keystroke would be persisted and re-grade the card. Drafts
  // commit on blur / Enter once committable; Escape discards.
  const [drafts, setDrafts] = useState<Partial<Record<GradingRubricKey, string>>>({});
  const { selectedId, customProfiles } = useStoreShallow(useIdealProfilesStore, (s) => ({
    selectedId: s.selectedId,
    customProfiles: s.customProfiles,
  }));

  const profileId = settings?.gradingProfile === 'broadcast' ? 'broadcast' : 'casual';
  const grading = getRubricGrading();
  const defaults = rubricDefaultsFor(grading ? grading.rubricDefaults(profileId) : null);
  const overrides = settings?.gradingRubric ?? {};
  const customized = overrideCount(overrides);

  const setDraft = (key: GradingRubricKey, text: string) => setDrafts((d) => ({ ...d, [key]: text }));
  const clearDraft = (key: GradingRubricKey) => setDrafts((d) => { const next = { ...d }; delete next[key]; return next; });
  /* c8 ignore start -- input event glue (onBlur/onKeyDown); this harness
     renders with react-dom/server, so DOM events never fire. The decision
     logic is the pure isCommittableDraft/rubricPatchFor, tested in
     grading-rubric.test.ts. */
  const commit = (key: GradingRubricKey) => {
    const raw = drafts[key];
    if (raw === undefined) return;
    if (isCommittableDraft(key, raw)) {
      void useSettingsStore.getState().updateSettings({ gradingRubric: rubricPatchFor(overrides, defaults, key, raw) });
    }
    clearDraft(key);
  };
  /* c8 ignore stop */

  const options = profileSelectOptions(customProfiles);
  const builtin = options.filter((o) => o.group === 'builtin');
  const custom = options.filter((o) => o.group === 'custom');

  return (
    <>
      <label className="ai-field" id="grading-baseline-field" {...(baselineHelp ?? {})}>
        <span className="ai-field-label">Ideal EQ curve (grading target)</span>
        <div className="grading-baseline-row">
          <div className="select-wrap">
            <select
              id="grading-baseline-select"
              aria-label="Ideal EQ curve used for grading"
              aria-describedby="grading-baseline-note"
              value={selectedId}
              onChange={(e) => void useIdealProfilesStore.getState().select(e.target.value)}
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
            </select>
            <span className="select-caret" dangerouslySetInnerHTML={{ __html: iconSvg('chevron-down', 16) }} />
          </div>
          <button
            type="button"
            id="grading-baseline-edit-btn"
            className="btn btn-secondary sm"
            onClick={() => useIdealProfilesStore.getState().openEditor()}
          >
            <span dangerouslySetInnerHTML={{ __html: iconSvg('settings', 14) }} />
            Edit or capture curve…
          </button>
        </div>
      </label>
      <div className="rubric-fields" id="grading-rubric-fields" {...(rubricHelp ?? {})}>
      <div className="rubric-head" id="grading-rubric-head">
        <span className="ai-field-label">Rubric thresholds</span>
        <span className="rubric-status" id="grading-rubric-status">
          {customized > 0 ? `${customized} customized` : `${profileId === 'broadcast' ? 'Broadcast-ready' : 'Casual / volunteer'} defaults`}
        </span>
        <button
          type="button"
          id="grading-rubric-reset-btn"
          className="btn btn-secondary sm"
          disabled={customized === 0}
          onClick={() => void useSettingsStore.getState().updateSettings({ gradingRubric: {} })}
        >
          Reset to defaults
        </button>
      </div>
      <div className="rubric-grid" id="grading-rubric-grid">
        {RUBRIC_GROUP_ORDER.map((group) => (
          <div className="rubric-group" key={group}>
            <div className="rubric-group-title">{RUBRIC_GROUP_LABELS[group]}</div>
            {RUBRIC_FIELDS.filter((f) => f.group === group).map((f) => {
              const value = rubricFieldValue(overrides, defaults, f.key);
              const overridden = isOverridden(overrides, f.key);
              const id = rubricInputId(f.key);
              const { min, max } = rubricBounds(f.key);
              const draft = drafts[f.key];
              return (
                <div className={`rubric-row${overridden ? ' overridden' : ''}`} key={f.key}>
                  <label htmlFor={id} title={f.hint}>{f.label}</label>
                  <input
                    id={id}
                    className="rubric-num"
                    type="number"
                    step={f.step}
                    min={min}
                    max={max}
                    title={f.hint}
                    aria-label={`${f.label} (${f.unit})`}
                    aria-describedby="grading-rubric-note"
                    data-default={defaults[f.key] ?? ''}
                    value={draft ?? (value ?? '')}
                    onChange={(e) => setDraft(f.key, e.target.value)}
                    /* c8 ignore start -- event glue, see commit() */
                    onBlur={() => commit(f.key)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') clearDraft(f.key);
                    }}
                    /* c8 ignore stop */
                  />
                  <span className="rubric-unit">{f.unit}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      </div>
    </>
  );
}
