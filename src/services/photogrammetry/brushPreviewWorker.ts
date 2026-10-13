import { stabilizeBrushPly } from './stabilizeBrushPly';

interface PreviewTraining {
  trainSteps(steps: number): Promise<Array<{ iter?: number }>>;
  exportPly(): Promise<Uint8Array>;
}

/** Serialize readbacks with training: wasm-bindgen must never borrow Training twice. */
export function attachBrushPreview(
  training: PreviewTraining, channelId: string, initialIteration = 0,
  points: ArrayBuffer | null = null,
): () => void {
  const channel = new BroadcastChannel(`brush-preview:${channelId}`);
  const trainSteps = training.trainSteps.bind(training);
  const exportPly = training.exportPly.bind(training);
  let queue: Promise<unknown> = Promise.resolve();
  let iteration = initialIteration;
  let pending = false;
  let closed = false;
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };
  training.trainSteps = steps => serialize(async () => {
    const messages = await trainSteps(steps);
    for (const message of messages) if (message.iter !== undefined) iteration = message.iter;
    return messages;
  });
  training.exportPly = () => serialize(exportPly);
  channel.onmessage = event => {
    if (event.data?.type !== 'request' || pending || closed) return;
    pending = true;
    void serialize(async () => {
      if (closed) return;
      if (iteration === 0) {
        channel.postMessage({ type: 'waiting' });
        return;
      }
      const raw = await exportPly();
      const result = points ? stabilizeBrushPly(raw, points) : null;
      const bytes = (result?.bytes ?? raw).slice();
      if (!closed) channel.postMessage({ type: 'preview', bytes, iteration,
        warning: result?.discardedSplats ? `${result.discardedSplats} unstable splats hidden.` : null });
    }).catch(error => {
      if (!closed) channel.postMessage({ type: 'error', message: String(error) });
    }).finally(() => { pending = false; });
  };
  return () => { closed = true; channel.close(); };
}
