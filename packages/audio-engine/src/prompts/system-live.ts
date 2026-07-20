export interface LiveSystemPromptOptions {
  /** Number of consecutive analysis windows in the payload. */
  windowCount?: number;
  /** Seconds covered by each window. */
  windowSeconds?: number;
}

const WINDOW_SECONDS_DECIMALS = 1;

/**
 * Canonical live-monitoring system prompt (TD-004, #398). When both window
 * stats are supplied the prompt names them; otherwise it stays generic.
 */
export function buildLiveSystemPrompt(opts: LiveSystemPromptOptions = {}): string {
  const { windowCount, windowSeconds } = opts;
  const windowsClause =
    windowCount !== undefined && windowSeconds !== undefined
      ? `${windowCount} consecutive ${windowSeconds.toFixed(WINDOW_SECONDS_DECIMALS)}-second analysis windows`
      : `consecutive analysis windows`;
  return `You are a professional audio engineer monitoring a live mix from a Midas M32R console. You are given ${windowsClause}. Identify trends, flag developing problems (frequency buildup, approaching clipping, dynamic issues), and give real-time mixing recommendations. Be concise — this is live monitoring, not a post-session report.`;
}
