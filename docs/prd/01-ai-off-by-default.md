# PRD 01 — AI/LLM disabled by default

## Problem
AI/LLM analysis adds complexity we want to defer. All AI capability should be **off by
default** and hidden in the UI, but the code stays wired in so we can re-enable it later
with a single flag.

## Scope
- New persisted setting `aiEnabled` (default `false`) in
  `~/Library/Application Support/SoundBuddy/settings.json`.
- Env override `SOUND_BUDDY_AI_ENABLED=1` for dev.
- When disabled:
  - The **AI Engineer** right-hand panel (`#ai-panel`) is hidden; `#workspace` reflows
    to two columns.
  - The `Analyze with AI` button, the live LLM-interval slider, and the "next AI
    analysis in Ns" countdown are hidden / inert.
  - `streamNarrative()` (app) and `analyzeWithClaude()` (CLI) short-circuit to a
    disabled outcome without contacting any provider — the single backend choke points.
- When enabled: behavior is exactly as today.

## Non-goals
- No change to provider selection, prompts, or streaming mechanics.
- No new UI to toggle the flag in-app for this release (edit the settings file / env
  var). A Preferences toggle can come later.

## Backend choke points
- App: gate `streamNarrative()` in `app/electron/llm.ts` → return
  `{ ok:false, reason:'disabled' }` when `aiEnabled` is false. Also gate the auto-LLM
  `setInterval` and the `trigger-llm-analysis` handler in `ipc.ts`.
- CLI: gate `analyzeWithClaude()` in `packages/ai-analyst` (already skippable via
  `--no-ai`; make disabled-by-config the default and require opt-in).

## UI
- Renderer reads the flag once at boot via a new IPC `getSettings()` and toggles a
  `body.ai-disabled` class that hides the AI affordances via CSS.

## Acceptance criteria
- Fresh install (no settings file): no AI panel, no AI buttons, no network/provider
  calls from analysis; report card + spectrum still fully functional.
- Setting `aiEnabled:true` (or env var) restores today's AI panel and behavior.
- Existing e2e tests updated for the two-column default layout.
</content>
