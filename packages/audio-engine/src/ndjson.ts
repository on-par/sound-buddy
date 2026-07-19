// Incrementally parse newline-delimited JSON from a byte stream — Ollama's
// /api/chat HTTP responses and (eventually, e7-14) subprocess stdout. Buffers
// partial lines across chunks (a JSON object may be split mid-line at a chunk
// boundary), skips blank lines, and silently ignores non-JSON lines. Data
// after the final newline is never delivered.
export interface NdjsonSource {
  on(event: "data", listener: (chunk: Buffer) => void): unknown;
}

export function readNdjsonLines(
  stream: NdjsonSource,
  onObject: (data: Record<string, unknown>) => void,
): void {
  let lineBuffer = "";
  stream.on("data", (chunk: Buffer) => {
    lineBuffer += chunk.toString();
    const lines = lineBuffer.split("\n");
    lineBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        onObject(JSON.parse(trimmed) as Record<string, unknown>);
      } catch {
        // ignore non-JSON lines
      }
    }
  });
}

/** One parsed line of an Ollama /api/chat streaming response. */
export interface OllamaChatChunk {
  message?: { content?: string };
  done?: boolean;
}

// Ollama /api/chat NDJSON semantics on top of readNdjsonLines: content deltas
// until a done:true line, which fires onDone (once) and emits no delta.
export function parseOllamaNdjsonStream(
  stream: NdjsonSource,
  onDelta: (text: string) => void,
  onDone: () => void,
): void {
  readNdjsonLines(stream, (obj) => {
    const chunk = obj as OllamaChatChunk;
    if (!chunk.done && chunk.message?.content) onDelta(chunk.message.content);
    if (chunk.done) onDone();
  });
}
