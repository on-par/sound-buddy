// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  clampMarkSecs,
  createTimelineMarksModel,
  TIMELINE_INSERT_MARKER_DEFAULT_SECS,
} from './timeline-state';

describe('timeline-state', () => {
  describe('defaults', () => {
    it('reports playheadSecs 0 and insertMarkerSecs at the default', () => {
      const model = createTimelineMarksModel();
      expect(model.getPlayheadSecs()).toBe(0);
      expect(model.getInsertMarkerSecs()).toBe(TIMELINE_INSERT_MARKER_DEFAULT_SECS);
    });

    it('getMarks agrees with the two getters', () => {
      const model = createTimelineMarksModel();
      expect(model.getMarks()).toEqual({
        playheadSecs: model.getPlayheadSecs(),
        insertMarkerSecs: model.getInsertMarkerSecs(),
      });
    });
  });

  describe('independence (AC #1)', () => {
    it('advancing the playhead never changes the insert marker', () => {
      const model = createTimelineMarksModel();
      model.setInsertMarkerSecs(12.5);
      for (const secs of [0.1, 0.2, 0.5, 1, 2, 3]) {
        model.setPlayheadSecs(secs);
        expect(model.getInsertMarkerSecs()).toBe(12.5);
        expect(model.getPlayheadSecs()).toBe(secs);
      }
    });

    it('moving the insert marker never changes the playhead', () => {
      const model = createTimelineMarksModel();
      model.setPlayheadSecs(7);
      for (const secs of [1, 2, 3.5]) {
        model.setInsertMarkerSecs(secs);
        expect(model.getPlayheadSecs()).toBe(7);
        expect(model.getInsertMarkerSecs()).toBe(secs);
      }
    });
  });

  describe('resetForSession', () => {
    it('returns both values to their defaults', () => {
      const model = createTimelineMarksModel();
      model.setPlayheadSecs(10);
      model.setInsertMarkerSecs(20);
      model.resetForSession();
      expect(model.getPlayheadSecs()).toBe(0);
      expect(model.getInsertMarkerSecs()).toBe(TIMELINE_INSERT_MARKER_DEFAULT_SECS);
    });
  });

  describe('clampMarkSecs', () => {
    it('maps NaN, Infinity, -Infinity and negative values to 0', () => {
      expect(clampMarkSecs(NaN)).toBe(0);
      expect(clampMarkSecs(Infinity)).toBe(0);
      expect(clampMarkSecs(-Infinity)).toBe(0);
      expect(clampMarkSecs(-5)).toBe(0);
    });

    it('passes a finite positive value through unchanged', () => {
      expect(clampMarkSecs(42.5)).toBe(42.5);
    });

    it('is applied by the setters', () => {
      const model = createTimelineMarksModel();
      model.setPlayheadSecs(NaN);
      expect(model.getPlayheadSecs()).toBe(0);
      model.setInsertMarkerSecs(-Infinity);
      expect(model.getInsertMarkerSecs()).toBe(0);
    });
  });

  describe('subscribe', () => {
    it('fires on a real change and receives the new marks', () => {
      const model = createTimelineMarksModel();
      const seen: unknown[] = [];
      model.subscribe((marks) => seen.push(marks));
      model.setPlayheadSecs(5);
      expect(seen).toEqual([{ playheadSecs: 5, insertMarkerSecs: 0 }]);
    });

    it('does not fire when a setter writes the value already stored', () => {
      const model = createTimelineMarksModel();
      model.setPlayheadSecs(5);
      let calls = 0;
      model.subscribe(() => { calls += 1; });
      model.setPlayheadSecs(5);
      expect(calls).toBe(0);
    });

    it('stops firing after the returned unsubscribe is called', () => {
      const model = createTimelineMarksModel();
      let calls = 0;
      const unsubscribe = model.subscribe(() => { calls += 1; });
      model.setPlayheadSecs(1);
      unsubscribe();
      model.setPlayheadSecs(2);
      expect(calls).toBe(1);
    });
  });

  describe('immutability', () => {
    it('getMarks returns a frozen object', () => {
      const model = createTimelineMarksModel();
      expect(Object.isFrozen(model.getMarks())).toBe(true);
    });

    it('object identity changes only on a real change', () => {
      const model = createTimelineMarksModel();
      const before = model.getMarks();
      model.setPlayheadSecs(0); // already 0 -- no real change
      expect(model.getMarks()).toBe(before);
      model.setPlayheadSecs(9);
      expect(model.getMarks()).not.toBe(before);
    });
  });

  describe('purity guard', () => {
    it('never imports daw-shell-runtime, timeline-bpm or zustand, and never touches document', () => {
      const source = readFileSync(join(__dirname, 'timeline-state.ts'), 'utf8');
      expect(source).not.toMatch(/from '\.\/daw-shell-runtime'/);
      expect(source).not.toMatch(/from '\.\/timeline-bpm'/);
      expect(source).not.toMatch(/from 'zustand'/);
      expect(source).not.toMatch(/\bdocument\./);
    });
  });
});
