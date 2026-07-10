// `GET /activate` handler (#112) — the self-contained HTML page a buyer lands on
// after Stripe checkout redirects to `soundbuddy.online/activate?session_id=…`.
// It never talks to Stripe itself: its inline script fetches `/api/license`
// (handlers/license.ts) and renders whatever that endpoint returns.
//
// Fully self-contained: one inline <style>, one inline <script>, system font
// stack — zero external scripts/styles/fonts/images, so the page renders and
// works even if third-party asset loading is blocked.
//
// SECURITY: `session_id` is attacker-influenced (it's a URL query param) and is
// reflected into the page, so it is HTML-escaped before being embedded in
// markup (a `data-` attribute) rather than interpolated into markup or script
// text directly. Never log request query strings.

import type { Env } from "../index";
import { html } from "../http";

/** Escape the five HTML-significant characters — safe for both attribute and
 * text-node contexts. */
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const PAGE_STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: #0b0d12;
    color: #f4f5f7;
    padding: 24px;
  }
  .card {
    width: 100%;
    max-width: 420px;
    background: #14171f;
    border: 1px solid #262b36;
    border-radius: 16px;
    padding: 32px;
    text-align: center;
  }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p { color: #a7adba; font-size: 14px; line-height: 1.5; margin: 0 0 20px; }
  .key-field {
    width: 100%;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
    padding: 12px;
    border-radius: 8px;
    border: 1px solid #2c313d;
    background: #0b0d12;
    color: #f4f5f7;
    margin-bottom: 12px;
  }
  button {
    width: 100%;
    padding: 12px 16px;
    border-radius: 8px;
    border: none;
    background: #5b8cff;
    color: #fff;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }
  .hint { margin-top: 16px; font-size: 12px; color: #767c8a; }
`;

function pageShell(bodyHtml: string, bodyAttrs = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Sound Buddy — Activate</title>
<style>${PAGE_STYLE}</style>
</head>
<body${bodyAttrs}>
  <div class="card">
${bodyHtml}
  </div>
</body>
</html>`;
}

/** No `session_id` at all — nothing to fetch, so skip straight to the email
 * fallback rather than showing a spinner that will never resolve. */
function renderFallbackPage(): string {
  return pageShell(`    <h1>Check your email</h1>
    <p>Your Sound Buddy license key is on its way — it'll land in your inbox shortly.</p>
    <p class="hint">Already have it? Open Sound Buddy → Settings → License to activate.</p>`);
}

/**
 * `session_id` present — the page polls `/api/license` until it gets a key, a
 * terminal refusal, or times out, then swaps the visible panel. `sessionId` is
 * HTML-escaped into a `data-` attribute (never interpolated into the inline
 * script), and the inline script builds the fetch URL with
 * `encodeURIComponent` off that attribute.
 */
function renderActivationPage(sessionId: string): string {
  const body = `    <div id="pending">
      <h1>Finalizing your purchase&hellip;</h1>
      <p>Hang tight — this usually takes just a few seconds.</p>
    </div>
    <div id="ready" style="display:none">
      <h1>You're all set</h1>
      <p>Paste this into Sound Buddy → Settings → License to unlock Pro.</p>
      <input id="key-field" class="key-field" type="text" readonly />
      <button id="copy-button" type="button">Copy license key</button>
      <p class="hint" id="copy-hint"></p>
    </div>
    <div id="fallback" style="display:none">
      <h1>Check your email</h1>
      <p>We couldn't confirm this checkout — your license key will also be emailed to you. If it doesn't arrive, contact support.</p>
    </div>
    <script>
    (function () {
      var sessionId = document.body.getAttribute("data-session-id") || "";
      var pendingEl = document.getElementById("pending");
      var readyEl = document.getElementById("ready");
      var fallbackEl = document.getElementById("fallback");
      var keyField = document.getElementById("key-field");
      var copyButton = document.getElementById("copy-button");
      var copyHint = document.getElementById("copy-hint");

      function showFallback() {
        pendingEl.style.display = "none";
        fallbackEl.style.display = "block";
      }

      function showKey(key) {
        pendingEl.style.display = "none";
        readyEl.style.display = "block";
        keyField.value = key;
      }

      copyButton.addEventListener("click", function () {
        function selectField() {
          keyField.focus();
          keyField.select();
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(keyField.value).then(
            function () { copyHint.textContent = "Copied!"; },
            function () {
              selectField();
              copyHint.textContent = "Selected — press Cmd/Ctrl+C to copy.";
            },
          );
        } else {
          selectField();
          copyHint.textContent = "Selected — press Cmd/Ctrl+C to copy.";
        }
      });

      var POLL_INTERVAL_MS = 2000;
      var POLL_TIMEOUT_MS = 30000;
      var startedAt = Date.now();

      function poll() {
        fetch("/api/license?session_id=" + encodeURIComponent(sessionId))
          .then(function (res) {
            if (res.status === 200) {
              return res.json().then(function (body) { showKey(body.key); });
            }
            if (res.status === 202) {
              if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
                showFallback();
                return;
              }
              setTimeout(poll, POLL_INTERVAL_MS);
              return;
            }
            showFallback();
          })
          .catch(showFallback);
      }

      if (sessionId) {
        poll();
      } else {
        showFallback();
      }
    })();
    </script>`;
  return pageShell(body, ` data-session-id="${escapeHtml(sessionId)}"`);
}

/**
 * Handle `GET /activate?session_id=…`: render the self-contained success page.
 * Missing `session_id` renders the email fallback directly (no fetch, no
 * spinner that can never resolve).
 */
export function handleActivate(request: Request, _env: Env, _ctx: ExecutionContext): Response {
  const sessionId = new URL(request.url).searchParams.get("session_id");
  return html(sessionId ? renderActivationPage(sessionId) : renderFallbackPage());
}
