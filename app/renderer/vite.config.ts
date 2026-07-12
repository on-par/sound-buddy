// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The production CSP meta tag in index.html (`default-src 'self'`) blocks the
// Vite dev server's HMR websocket, which the built app never loads. Widen
// `connect-src` for `localhost:5173` only when serving (`apply: 'serve'`) so
// the built output's CSP — verified by the Electron smoke test — is never
// touched by this plugin. Reads the CSP straight out of the `html` Vite hands
// this hook (index.html's own content, not a copy) so there's no second
// literal of the policy to drift out of sync.
function devServerCsp(): Plugin {
  const CSP_ATTR = /(<meta http-equiv="Content-Security-Policy"\s+content=")([^"]*)(")/;
  return {
    name: 'sound-buddy-dev-server-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(
        CSP_ATTR,
        (_match, open: string, prodCsp: string, close: string) =>
          `${open}${prodCsp}; connect-src 'self' ws://localhost:5173 http://localhost:5173${close}`,
      );
    },
  };
}

// Scaffolding only (#303) — this bundles the existing renderer verbatim (see
// src/App.tsx) into one self-contained dist/index.html so Electron's
// loadFile() keeps working unchanged. No decomposition happens here (#302).
export default defineConfig({
  plugins: [react(), viteSingleFile(), devServerCsp()],
  build: {
    outDir: 'dist',
    // Single-file output: no external .css/.js, everything inlined into
    // dist/index.html so the packaged app ships one static file.
    assetsInlineLimit: Infinity,
    cssCodeSplit: false,
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
