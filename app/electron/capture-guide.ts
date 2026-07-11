// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Capture-guide deep link (#142). The in-app "Grade your own service" panel's
// "Read the full guide" CTA opens a hosted docs page in the user's browser via
// shell.openExternal. Kept as a pure function so it's unit-testable and the URL
// isn't baked into the renderer; main.ts wires it behind 'open-capture-guide'.
const DEFAULT_URL = 'https://soundbuddy.online/record-your-service';

export function captureGuideUrl(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.SOUND_BUDDY_GUIDE_URL;
  return (override && override.trim()) || DEFAULT_URL;
}
