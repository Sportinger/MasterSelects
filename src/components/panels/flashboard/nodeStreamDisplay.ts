const NODE_STREAM_FENCE = '```ms-nodegraph-v1';

/**
 * The chat shows an executable node stream as one summary line. The stored
 * message keeps the raw records (copy, history); only the rendered text is short.
 */
export function collapseNodeStreamBlocks(text: string): string {
  if (!text.includes(NODE_STREAM_FENCE)) return text;
  let output = '';
  let index = 0;
  for (;;) {
    const start = text.indexOf(NODE_STREAM_FENCE, index);
    if (start < 0) return output + text.slice(index);
    output += text.slice(index, start);
    const bodyStart = start + NODE_STREAM_FENCE.length;
    const end = text.indexOf('\n```', bodyStart);
    const steps = (text.slice(bodyStart, end < 0 ? undefined : end).match(/"op"\s*:\s*"tool"/g) ?? []).length;
    output += end < 0 ? `[Node-Stream läuft: ${steps} Schritte …]` : `[Node-Stream: ${steps} Schritte]`;
    if (end < 0) return output;
    index = end + 4;
  }
}

/**
 * Coalesces streamed text into at most one chat update per interval. Rendering
 * the whole growing answer for every few-character delta starves the main
 * thread, which also delays node-stream edits waiting for a presentation frame.
 */
export function createStreamingTextThrottle(apply: () => void, intervalMs = 100) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = 0;
  const run = () => { timer = undefined; last = Date.now(); apply(); };
  return {
    schedule(): void {
      if (timer !== undefined) return;
      const wait = intervalMs - (Date.now() - last);
      if (wait <= 0) run();
      else timer = setTimeout(run, wait);
    },
    cancel(): void {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}
