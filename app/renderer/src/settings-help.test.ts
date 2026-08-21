// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';
import {
  SETTINGS_HELP_ENTRIES,
  SETTINGS_SECTION_HELP,
  settingsHelpNoteId,
  resolveSettingsHelp,
  settingsHelpHandlers,
} from './settings-help';
import { SETTINGS_SECTIONS, settingsSectionFor, type SettingsControl } from './SettingsPanel';

describe('resolveSettingsHelp', () => {
  it("returns the active row's copy", () => {
    const text = resolveSettingsHelp('usageSignal', 'privacy');
    expect(text).toBe(
      SETTINGS_HELP_ENTRIES.find((e) => e.control === 'usageSignal')?.text
    );
    expect(text).toContain('anonymous');
    expect(text).toContain('never audio');
  });

  it('returns the section description when nothing is active', () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(resolveSettingsHelp(null, section)).toBe(SETTINGS_SECTION_HELP[section]);
    }
  });

  it('keys off the active row, not the current pane', () => {
    expect(resolveSettingsHelp('gradingProfile', 'privacy')).toBe(
      SETTINGS_HELP_ENTRIES.find((e) => e.control === 'gradingProfile')?.text
    );
  });

  it('falls back to the section description for a control with no help entry', () => {
    expect(resolveSettingsHelp('version', 'about')).toBe(SETTINGS_SECTION_HELP.about);
  });
});

describe('settingsHelpNoteId', () => {
  it('returns the note id for a control with a help entry', () => {
    expect(settingsHelpNoteId('crashReporting')).toBe('crash-reporting-note');
  });

  it('throws an actionable error for a control with no help entry', () => {
    expect(() => settingsHelpNoteId('version')).toThrow(/SETTINGS_HELP_ENTRIES/);
  });
});

describe('settingsHelpHandlers', () => {
  it('onMouseEnter and onFocus activate the control', () => {
    const setActive = vi.fn();
    const handlers = settingsHelpHandlers('usageSignal', setActive);
    handlers.onMouseEnter();
    expect(setActive).toHaveBeenCalledWith('usageSignal');
    handlers.onFocus();
    expect(setActive).toHaveBeenCalledWith('usageSignal');
  });

  it('onMouseLeave and onBlur clear the active control', () => {
    const setActive = vi.fn();
    const handlers = settingsHelpHandlers('usageSignal', setActive);
    handlers.onMouseLeave();
    expect(setActive).toHaveBeenCalledWith(null);
    handlers.onBlur();
    expect(setActive).toHaveBeenCalledWith(null);
  });
});

describe('SETTINGS_HELP_ENTRIES table integrity', () => {
  it('has a unique noteId ending in -note for every entry', () => {
    const seen = new Set<string>();
    for (const entry of SETTINGS_HELP_ENTRIES) {
      expect(entry.noteId.endsWith('-note')).toBe(true);
      expect(seen.has(entry.noteId)).toBe(false);
      seen.add(entry.noteId);
    }
  });

  it('maps every entry control to a real section', () => {
    for (const entry of SETTINGS_HELP_ENTRIES) {
      expect(() => settingsSectionFor(entry.control as SettingsControl)).not.toThrow();
    }
  });

  it('has non-empty text for every entry', () => {
    for (const entry of SETTINGS_HELP_ENTRIES) {
      expect(entry.text.length).toBeGreaterThan(0);
    }
  });

  it('has a non-empty SETTINGS_SECTION_HELP description for every section', () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(SETTINGS_SECTION_HELP[section].length).toBeGreaterThan(0);
    }
  });
});
