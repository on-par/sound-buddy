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

export interface SendDunningEmailParams {
  /** Recipient. Undefined when Stripe had no email — delivery is then skipped. */
  to?: string;
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

function buildDunningEmail(env: Env): { subject: string; text: string; html: string } {
  const subject = "Your Sound Buddy payment didn't go through";

  const text = [
    "Hi,",
    "",
    "We couldn't process the payment for your Sound Buddy subscription.",
    "Your license still works for now — update your card in the Customer Portal to avoid an interruption:",
    env.CUSTOMER_PORTAL_URL,
    "We'll retry the charge automatically.",
    `Need help? Contact ${env.SUPPORT_EMAIL}.`,
  ].join("\n");

  const html = [
    "<p>Hi,</p>",
    "<p>We couldn't process the payment for your Sound Buddy subscription.</p>",
    `<p>Your license still works for now — update your card in the Customer Portal to avoid an interruption:</p>`,
    `<p><a href="${escapeHtml(env.CUSTOMER_PORTAL_URL)}">${escapeHtml(env.CUSTOMER_PORTAL_URL)}</a></p>`,
    "<p>We'll retry the charge automatically.</p>",
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

/** Result is informational only; callers must not depend on success. */
export async function sendDunningEmail(
  env: Env,
  params: SendDunningEmailParams,
  deps: DeliveryDeps = {},
): Promise<{ ok: boolean }> {
  try {
    if (!params.to) {
      console.log("dunning email: no recipient — skipping");
      return { ok: false };
    }

    if (!env.RESEND_API_KEY) {
      console.error("dunning email: RESEND_API_KEY not configured");
      return { ok: false };
    }

    const { subject, text, html } = buildDunningEmail(env);
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
      console.error("dunning email send failed", { status: res.status });
      return { ok: false };
    }

    console.log("dunning email sent");
    return { ok: true };
  } catch {
    console.error("dunning email send failed", { status: undefined });
    return { ok: false };
  }
}

export interface SendWaitlistConfirmationParams {
  /** Recipient, already lowercased by the handler. Never logged. */
  to: string;
}

export function buildWaitlistConfirmationEmail(env: Env): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = "You're on the Sound Buddy waitlist";

  // Copy deliberately promises only what the signup form promises. Widening
  // this to "weekly updates" requires the consent copy and privacy-policy
  // section in #641 to land first.
  const text = [
    "Hi,",
    "",
    "You're on the list. Sound Buddy grades the recording you already have and",
    "names what to fix before next Sunday, all on your own machine.",
    "",
    "We'll email you when early access opens, plus the occasional note on what",
    "we're building. Nothing else, and you can unsubscribe from any message.",
    "",
    `Questions, or want to tell us about your room? Just reply, or write ${env.SUPPORT_EMAIL}.`,
  ].join("\n");

  const html = [
    "<p>Hi,</p>",
    "<p>You're on the list. Sound Buddy grades the recording you already have and names what to fix before next Sunday, all on your own machine.</p>",
    "<p>We'll email you when early access opens, plus the occasional note on what we're building. Nothing else, and you can unsubscribe from any message.</p>",
    `<p>Questions, or want to tell us about your room? Just reply, or write <a href="mailto:${escapeHtml(env.SUPPORT_EMAIL)}">${escapeHtml(env.SUPPORT_EMAIL)}</a>.</p>`,
  ].join("");

  return { subject, text, html };
}

/**
 * Confirmation receipt for a waitlist signup (#639). Best-effort by design:
 * the KV row written by the handler is the source of truth, so callers invoke
 * this through `ctx.waitUntil` and ignore the result. A Resend outage must
 * never turn a stored signup into a user-visible failure.
 */
export async function sendWaitlistConfirmationEmail(
  env: Env,
  params: SendWaitlistConfirmationParams,
  deps: DeliveryDeps = {},
): Promise<{ ok: boolean }> {
  try {
    if (!env.RESEND_API_KEY) {
      console.error("waitlist confirmation: RESEND_API_KEY not configured");
      return { ok: false };
    }

    const { subject, text, html } = buildWaitlistConfirmationEmail(env);
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
      console.error("waitlist confirmation send failed", { status: res.status });
      return { ok: false };
    }

    console.log("waitlist confirmation sent");
    return { ok: true };
  } catch {
    console.error("waitlist confirmation send failed", { status: undefined });
    return { ok: false };
  }
}

/**
 * Upsert a signup into the configured Resend Audience (#640), so broadcasts
 * have a real list to send to and unsubscribe/bounce handling lives with the
 * email vendor rather than in this Worker.
 *
 * KV stays the source of truth; the Audience is a projection of it. Like the
 * confirmation email this is best-effort and called via `ctx.waitUntil`.
 * Resend's create-contact call is an upsert keyed by email, so a repeat signup
 * updates the existing contact instead of duplicating it.
 */
export async function syncWaitlistContact(
  env: Env,
  params: { email: string; churchName?: string },
  deps: DeliveryDeps = {},
): Promise<{ ok: boolean }> {
  try {
    if (!env.RESEND_API_KEY) {
      console.error("waitlist audience sync: RESEND_API_KEY not configured");
      return { ok: false };
    }
    if (!env.WAITLIST_AUDIENCE_ID) {
      console.error("waitlist audience sync: WAITLIST_AUDIENCE_ID not configured");
      return { ok: false };
    }

    const res = await (deps.fetch ?? fetch)(
      `https://api.resend.com/audiences/${env.WAITLIST_AUDIENCE_ID}/contacts`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: params.email,
          // Carried for segmentation (e.g. inviting a specific church first).
          ...(params.churchName ? { first_name: params.churchName } : {}),
          unsubscribed: false,
        }),
      },
    );

    if (!res.ok) {
      console.error("waitlist audience sync failed", { status: res.status });
      return { ok: false };
    }

    console.log("waitlist audience synced");
    return { ok: true };
  } catch {
    console.error("waitlist audience sync failed", { status: undefined });
    return { ok: false };
  }
}
