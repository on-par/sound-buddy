// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Renderer-safe pure formatting for scene-diff results (#264). Deliberately
// split out of ./scene-diff.ts, which the renderer never imports (it needs
// node/fs and the ESM-only scene-inspector loader) — every other renderer
// import that reaches into app/electron/ uses `import type` only, so this is
// the one file in that tree the renderer takes a real (non-type) runtime
// import from (ReportCardIsland). Keeping it isolated here, with nothing but
// a type-only @sound-buddy/shared import, keeps that boundary honest: a
// future node-builtin import landing in ./scene-diff.ts can't silently ship
// inside the renderer's single-file Vite bundle.

import type { SceneDiff } from '@sound-buddy/shared';

export const TOP_SCENE_CHANGES = 3;

function formatValue(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (typeof v === 'number') return v.toFixed(1);
  if (v === null || v === undefined) return '—';
  return String(v);
}

export function topSceneChanges(
  diff: SceneDiff,
  limit = TOP_SCENE_CHANGES,
): Array<{ label: string; from: string; to: string }> {
  return diff.changes.slice(0, limit).map((c) => ({
    label: c.label,
    from: formatValue(c.from),
    to: formatValue(c.to),
  }));
}
