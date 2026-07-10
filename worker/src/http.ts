// Shared HTTP helpers for the Worker. Kept in its own module so both the router
// (index.ts) and per-route handlers (webhook.ts, …) can use them without an
// index ↔ handler import cycle.

/** JSON response with the standard content-type and optional extra headers. */
export const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });

/** HTML response with the standard content-type and optional extra headers. */
export const html = (
  body: string,
  status = 200,
  headers: Record<string, string> = {},
): Response =>
  new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
  });

/** Escape the five HTML-significant characters — safe for both attribute and
 * text-node contexts. */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
