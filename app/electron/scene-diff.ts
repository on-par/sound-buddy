// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure app-layer wiring around @sound-buddy/scene-inspector's parseScene/
// diffScenes (#264): validates the two dropped .scn paths, reads them, parses
// them, and diffs them — translating every failure mode into an actionable,
// user-facing message instead of a raw thrown error or a crash. parseScene/
// diffScenes are injected (not imported directly) because the package ships
// ESM-only and the app's main process compiles CommonJS — the real
// implementations are resolved by ./scene-inspector-loader and assembled by
// the IPC handler (ipc/analysis.ts), keeping this module free of Electron/fs.
//
// Deliberately has NO node-builtin imports (no `node:path`): topSceneChanges
// below is imported at runtime by the renderer (ReportCardIsland/SceneChanges,
// #264) alongside computeSceneDiff living in the same file, and the renderer's
// Vite bundle can't resolve node builtins. basename is hand-rolled instead.

import type { Scene, SceneDiff } from '@sound-buddy/shared';

function fileBasename(p: string): string {
  return p.split(/[/\\]/).pop() || p;
}

export const SCENE_FILE_EXTENSION = '.scn';
export const TOP_SCENE_CHANGES = 3;

export interface SceneDiffDeps {
  readFile(path: string): string;
  fileExists(path: string): boolean;
  parseScene(content: string): Scene;
  diffScenes(a: Scene, b: Scene): SceneDiff;
}

export type SceneDiffResult =
  | { ok: true; diff: SceneDiff; nameA: string; nameB: string }
  | { ok: false; error: string };

export function computeSceneDiff(pathA: string, pathB: string, deps: SceneDiffDeps): SceneDiffResult {
  const paths = [pathA, pathB];

  for (const p of paths) {
    if (!p.toLowerCase().endsWith(SCENE_FILE_EXTENSION)) {
      return { ok: false, error: `${fileBasename(p)} isn't a scene file. Drop a .scn file exported from your M32R console.` };
    }
  }

  for (const p of paths) {
    if (!deps.fileExists(p)) {
      return { ok: false, error: `Couldn't find ${fileBasename(p)}. Move the file somewhere Sound Buddy can read it and drop it again.` };
    }
  }

  const contents: string[] = [];
  for (const p of paths) {
    try {
      contents.push(deps.readFile(p));
    } catch {
      return { ok: false, error: `Couldn't read ${fileBasename(p)}. Check the file isn't open in another program and try again.` };
    }
  }

  const scenes: Scene[] = [];
  for (let i = 0; i < paths.length; i++) {
    try {
      scenes.push(deps.parseScene(contents[i]));
    } catch {
      return {
        ok: false,
        error: `${fileBasename(paths[i])} isn't a valid M32R scene file. Export a fresh scene from the console (Setup → Scenes → Export) and try again.`,
      };
    }
  }

  const diff = deps.diffScenes(scenes[0], scenes[1]);
  return { ok: true, diff, nameA: scenes[0].name, nameB: scenes[1].name };
}

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
