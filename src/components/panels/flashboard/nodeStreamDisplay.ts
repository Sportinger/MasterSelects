/** Executable stream fences and how the chat names a block of each. */
const STREAM_FENCES = [
  { fence: '```ms-nodegraph-v1', label: () => 'Node-Stream' },
  { fence: '```ms-scene-v1', label: (body: string) => {
    const name = body.match(/"scene"\s*:\s*"([^"\\]{1,80})"/)?.[1];
    return name ? `Szene „${name}“` : 'Szene-Stream';
  } },
];

/**
 * The chat shows an executable node or scene stream as one summary line. The stored
 * message keeps the raw records (copy, history); only the rendered text is short.
 */
export function collapseNodeStreamBlocks(text: string): string {
  if (!STREAM_FENCES.some(({ fence }) => text.includes(fence))) return text;
  let output = '';
  let index = 0;
  for (;;) {
    const next = STREAM_FENCES.map(kind => ({ kind, start: text.indexOf(kind.fence, index) }))
      .filter(match => match.start >= 0).sort((a, b) => a.start - b.start)[0];
    if (!next) return output + text.slice(index);
    output += text.slice(index, next.start);
    const bodyStart = next.start + next.kind.fence.length;
    const end = text.indexOf('\n```', bodyStart);
    const body = text.slice(bodyStart, end < 0 ? undefined : end);
    const steps = (body.match(/"op"\s*:\s*"tool"/g) ?? []).length;
    const label = next.kind.label(body);
    output += end < 0 ? `[${label} läuft: ${steps} Schritte …]` : `[${label}: ${steps} Schritte]`;
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
