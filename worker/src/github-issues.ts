// GitHub issue filing for feedback ingest events (#930, epic #927).
//
// SECURITY (normative): never log event bodies, messages, or the issue body —
// only outcomes and HTTP status. NOTE: on-par/sound-buddy is a PUBLIC repo, so
// the issue body is a publication surface: contactEmail must never appear in it.

import type { Env } from "./index";
import type { FeedbackEvent } from "./handlers/ingest";

const GITHUB_ISSUES_REPO = "on-par/sound-buddy";
const GITHUB_ISSUES_API_URL = `https://api.github.com/repos/${GITHUB_ISSUES_REPO}/issues`;
const FEEDBACK_ISSUE_ASSIGNEE = "patrob";
// `epic:feedback` already exists on the repo — do NOT invent a new label name,
// because the issues API silently creates unknown labels.
const FEEDBACK_ISSUE_LABELS = ["epic:feedback"];
const GITHUB_API_VERSION = "2022-11-28";
const GITHUB_USER_AGENT = "sound-buddy-api"; // GitHub rejects requests with no User-Agent
const GITHUB_REQUEST_TIMEOUT_MS = 5_000;
const MAX_ISSUE_TITLE_LENGTH = 80;
const TITLE_ELLIPSIS = "…";

/** The subset of the GitHub create-issue payload this Worker sends. */
export interface GitHubIssueRequest {
  title: string;
  body: string;
  labels: string[];
  assignees: string[];
}

export interface CreateFeedbackIssueParams {
  /** Already redacted by `redactIngestEvent`. */
  event: FeedbackEvent;
  /** Server-assigned receipt timestamp, ISO. */
  receivedAt: string;
}

/** Injectable seam so tests never hit the network. Defaults to the global fetch. */
export interface GitHubIssueDeps {
  fetch?: typeof fetch;
}

/** `ok: false` means the caller must fall back to EVENTS_KV. */
export interface CreateFeedbackIssueResult {
  ok: boolean;
  /** Present only on success; safe to log (an issue number is not event content). */
  issueNumber?: number;
}

function buildIssueTitle(event: FeedbackEvent): string {
  const category = event.category ?? "other";
  const snippet = event.message.replace(/\s+/g, " ").trim();
  const prefix = `Feedback (${category}): `;
  const maxSnippetLength = MAX_ISSUE_TITLE_LENGTH - prefix.length;
  const truncatedSnippet =
    snippet.length > maxSnippetLength
      ? `${snippet.slice(0, maxSnippetLength - TITLE_ELLIPSIS.length)}${TITLE_ELLIPSIS}`
      : snippet;
  return `${prefix}${truncatedSnippet}`;
}

// The issue body is rendered as GitHub-flavored Markdown on a PUBLIC repo, and
// every field below is unauthenticated user input. Left unescaped, a
// submitter could @mention-spam arbitrary GitHub users (triggering real
// notifications), inject fake "---"-delimited metadata to mislead a human
// triager, or embed phishing links — none of which need any credential.
// A fenced code block (for the free-text message) and inline code spans (for
// the short fields) render their contents as literal text, defeating GFM
// mention/link/heading interpretation while keeping the values verbatim.

/** Wraps `text` in a GFM code fence long enough that no backtick run inside
 * `text` can prematurely close it. */
function codeFence(text: string): string {
  const longestBacktickRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
  return `${fence}\n${text}\n${fence}`;
}

/** Wraps `text` in a GFM inline code span, escaping any backticks it contains
 * so it can't break out of the span (and so it can't be linkified/mentioned). */
function inlineCode(text: string): string {
  const longestBacktickRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const delimiter = "`".repeat(longestBacktickRun + 1);
  const padding = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${delimiter}${padding}${text}${padding}${delimiter}`;
}

function buildIssueBody(event: FeedbackEvent, receivedAt: string): string {
  const metadata = [
    `- Category: ${event.category ?? "other"}`,
    `- App version: ${inlineCode(event.appVersion)}`,
    ...(event.osVersion !== undefined ? [`- macOS version: ${inlineCode(event.osVersion)}`] : []),
    ...(event.platform !== undefined ? [`- Platform: ${inlineCode(event.platform)}`] : []),
    `- Received: ${receivedAt}`,
    `- Reply address: ${event.contactEmail !== undefined ? "provided" : "not provided"}`,
  ];

  return [
    "### Feedback",
    "",
    codeFence(event.message),
    "",
    "---",
    "",
    ...metadata,
    "",
    "Filed automatically by the Sound Buddy ingest Worker (#930).",
  ].join("\n");
}

/** Pure title/body builder — no I/O — so formatting is unit-testable without the network. */
export function buildFeedbackIssue(event: FeedbackEvent, receivedAt: string): GitHubIssueRequest {
  return {
    title: buildIssueTitle(event),
    body: buildIssueBody(event, receivedAt),
    labels: [...FEEDBACK_ISSUE_LABELS],
    assignees: [FEEDBACK_ISSUE_ASSIGNEE],
  };
}

/**
 * File a feedback event as a GitHub issue on the public `on-par/sound-buddy`
 * repo. Mirrors `sendLicenseEmail` in `delivery.ts`: try/catch around the
 * whole body, `{ ok }` return, outcome-only logging, never throws. Callers
 * must fall back to `EVENTS_KV` on `ok: false`.
 */
export async function createFeedbackIssue(
  env: Env,
  params: CreateFeedbackIssueParams,
  deps: GitHubIssueDeps = {},
): Promise<CreateFeedbackIssueResult> {
  try {
    if (!env.GITHUB_ISSUES_TOKEN) {
      console.error("feedback issue: GITHUB_ISSUES_TOKEN not configured — falling back to KV");
      return { ok: false };
    }

    const issue = buildFeedbackIssue(params.event, params.receivedAt);
    const res = await (deps.fetch ?? fetch)(GITHUB_ISSUES_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_ISSUES_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        "User-Agent": GITHUB_USER_AGENT,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(issue),
      signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.error("feedback issue create failed", { status: res.status });
      return { ok: false };
    }

    const created = (await res.json()) as { number?: number };
    console.log("feedback issue created", { number: created.number });
    return { ok: true, ...(typeof created.number === "number" ? { issueNumber: created.number } : {}) };
  } catch {
    console.error("feedback issue create failed", { status: undefined });
    return { ok: false };
  }
}
