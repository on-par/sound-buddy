// License-key email delivery (#114).
//
// SECURITY (normative): never log signed `SB1.` license strings, key material,
// recipient email addresses, payload bodies, or KV values. Delivery logs are
// outcome/status only because `wrangler tail` / Logpush capture logs.

import type { Env } from "./index";
import { escapeHtml } from "./http";
import type { LicenseKind } from "./license-sign";

export interface SendLicenseEmailParams {
  /** Recipient. Undefined when Stripe had no email — delivery is then skipped. */
  to?: string;
  /** The freshly minted SB1 key string. Rendered into the email; never logged. */
  key: string;
  kind: LicenseKind;
  /** ISO expiry, present for subscription keys — rendered as "valid through". */
  expiresAt?: string;
}

/** Injectable seam so tests never hit the network. Defaults to the global fetch. */
export interface DeliveryDeps {
  fetch?: typeof fetch;
}

function buildLicenseEmail(
  params: SendLicenseEmailParams,
  env: Env,
): { subject: string; text: string; html: string } {
  const subject = "Your Sound Buddy license key";
  const expiry = params.expiresAt?.slice(0, 10);
  const kindLine =
    params.kind === "subscription"
      ? `Your subscription renews automatically${expiry ? ` and is valid through ${expiry}` : ""}. A fresh key is emailed each renewal.`
      : "This is a lifetime license for Sound Buddy.";

  const text = [
    "Hi,",
    "",
    "Here is your Sound Buddy license key:",
    params.key,
    "",
    "Open Sound Buddy, go to Activate, and paste this key.",
    kindLine,
    `Manage billing in the Customer Portal: ${env.CUSTOMER_PORTAL_URL}`,
    `Need help? Contact ${env.SUPPORT_EMAIL}.`,
  ].join("\n");

  const html = [
    "<p>Hi,</p>",
    "<p>Here is your Sound Buddy license key:</p>",
    `<pre><code>${escapeHtml(params.key)}</code></pre>`,
    "<p>Open Sound Buddy, go to Activate, and paste this key.</p>",
    `<p>${escapeHtml(kindLine)}</p>`,
    `<p>Manage billing in the Customer Portal: <a href="${escapeHtml(env.CUSTOMER_PORTAL_URL)}">${escapeHtml(env.CUSTOMER_PORTAL_URL)}</a></p>`,
    `<p>Need help? Contact ${escapeHtml(env.SUPPORT_EMAIL)}.</p>`,
  ].join("");

  return { subject, text, html };
}

/** Result is informational only; callers must not depend on success. */
export async function sendLicenseEmail(
  env: Env,
  params: SendLicenseEmailParams,
  deps: DeliveryDeps = {},
): Promise<{ ok: boolean }> {
  try {
    if (!params.to) {
      console.log("license email: no recipient — skipping (/activate is the redundant path)");
      return { ok: false };
    }

    if (!env.RESEND_API_KEY) {
      console.error("license email: RESEND_API_KEY not configured");
      return { ok: false };
    }

    const { subject, text, html } = buildLicenseEmail(params, env);
    const res = await (deps.fetch ?? fetch)("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.FROM_EMAIL,
        to: [params.to],
        subject,
        text,
        html,
      }),
    });

    if (!res.ok) {
      console.error("license email send failed", { status: res.status });
      return { ok: false };
    }

    console.log("license email sent");
    return { ok: true };
  } catch {
    console.error("license email send failed", { status: undefined });
    return { ok: false };
  }
}
