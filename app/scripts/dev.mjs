#!/usr/bin/env node
// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Dev orchestration (#303): start the renderer's Vite dev server, build the
// Electron main/preload process once, then launch Electron pointed at the
// dev server (SOUND_BUDDY_RENDERER_URL — see electron/main.ts createWindow).
// `npm run build`/`start`/e2e never set that env var, so they always load
// the built renderer/dist/index.html instead.
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const RENDERER_URL = 'http://localhost:5173';
const appDir = new URL('..', import.meta.url);
const rendererDir = new URL('../renderer', import.meta.url);

const children = [];
function run(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { stdio: 'inherit', ...opts });
  children.push(child);
  return child;
}

function stopAll() {
  for (const child of children) child.kill();
}
process.on('SIGINT', () => { stopAll(); process.exit(0); });
process.on('SIGTERM', () => { stopAll(); process.exit(0); });

async function waitForServer(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fetch(url);
      return;
    } catch {
      await delay(200);
    }
  }
  throw new Error(`renderer dev server did not come up at ${url} within ${timeoutMs}ms`);
}

const vite = run('npm', ['run', 'dev'], { cwd: rendererDir });
vite.on('exit', (code) => {
  if (code !== null && code !== 0) {
    console.error(`renderer dev server exited with code ${code}`);
    stopAll();
    process.exit(code);
  }
});

await waitForServer(RENDERER_URL, 20_000);

await new Promise((resolve, reject) => {
  const tsc = spawn('npx', ['tsc'], { stdio: 'inherit', cwd: appDir });
  tsc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`tsc exited with code ${code}`))));
});

const electron = run('npx', ['electron', 'dist/electron/main.js'], {
  cwd: appDir,
  env: { ...process.env, SOUND_BUDDY_RENDERER_URL: RENDERER_URL },
});
electron.on('exit', (code) => {
  stopAll();
  process.exit(code ?? 0);
});
