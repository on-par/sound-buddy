// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Console-changes panel for the scene-file diff (#264): renders the top-3
// changes a dropped before/after .scn pair produced, or the appropriate
// idle/loading/error state in between. Props are plain data (no store import)
// so this is fully testable via renderToString without the Electron bridge —
// ReportCardIsland wires it to useSceneDiffStore + topSceneChanges().

import { iconSvg } from './report-card';
import type { SceneDiffStatus } from './stores/sceneDiffStore';

export interface SceneChangeRow {
  label: string;
  from: string;
  to: string;
}

export interface SceneChangesProps {
  status: SceneDiffStatus;
  // Already capped at TOP_SCENE_CHANGES (topSceneChanges()'s output).
  changes: SceneChangeRow[];
  // The diff's full, uncapped change count — drives the "+n more" line.
  totalChanges: number;
  nameA: string | null;
  nameB: string | null;
  sceneError: string | null;
}

export default function SceneChanges({ status, changes, totalChanges, nameA, nameB, sceneError }: SceneChangesProps) {
  if (status === 'idle') return null;

  return (
    <div className="rc-section" id="rc-scene-changes">
      {status === 'one-loaded' && (
        <p className="dz-hint">Nothing to compare yet — drop a second .scn file to see what changed.</p>
      )}
      {status === 'diffing' && <p className="dz-hint">Comparing scenes…</p>}
      {status === 'error' && (
        <p className="scene-error" style={{ color: 'var(--issue-text)' }}>
          <span dangerouslySetInnerHTML={{ __html: iconSvg('alert-triangle', 16) }} />
          {sceneError}
        </p>
      )}
      {status === 'done' && totalChanges === 0 && (
        <p className="dz-hint">No console changes between these two scenes.</p>
      )}
      {status === 'done' && totalChanges > 0 && (
        <>
          <h2>Console changes</h2>
          <p className="dz-hint">
            {nameA} → {nameB}
          </p>
          <ul>
            {changes.map((c, i) => (
              <li key={i} className="rc-scene-change">
                {c.label}: {c.from} → {c.to}
              </li>
            ))}
          </ul>
          {totalChanges > changes.length && <p className="dz-hint">+{totalChanges - changes.length} more</p>}
        </>
      )}
    </div>
  );
}
