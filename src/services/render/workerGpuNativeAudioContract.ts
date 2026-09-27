export interface WorkerGpuNativeAudioInput {
  readonly clipId: string;
  /** Constant-speed mapping: audio source time = Flock source time + offset. */
  readonly sourceOffset: number;
  /** Null explicitly represents unavailable analysis, matching the main sampler. */
  readonly curve: { readonly url: string; readonly fingerprint: string; readonly byteLength: number } | null;
}

export const WORKER_FLOCK_AUDIO_MAX_BYTES = 32 * 1024 * 1024;

/** Enclosing scene admission already verified bounded plain-data ownership. */
export function isWorkerGpuNativeAudioInputs(value: unknown): value is readonly WorkerGpuNativeAudioInput[] {
  if (!Array.isArray(value) || value.length > 256) return false;
  const ids = new Set<string>();
  for (const input of value) {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key => !['clipId', 'sourceOffset', 'curve'].includes(key))
      || typeof input.clipId !== 'string' || !input.clipId || input.clipId.length > 256 || ids.has(input.clipId)
      || typeof input.sourceOffset !== 'number' || !Number.isFinite(input.sourceOffset)) return false;
    ids.add(input.clipId);
    const curve = input.curve;
    if (curve === null) continue;
    if (!curve || typeof curve !== 'object' || Array.isArray(curve)
      || Object.keys(curve).some(key => !['url', 'fingerprint', 'byteLength'].includes(key))
      || typeof curve.url !== 'string' || curve.url.length > 8192
      || typeof curve.fingerprint !== 'string' || !curve.fingerprint || curve.fingerprint.length > 256
      || !Number.isSafeInteger(curve.byteLength) || curve.byteLength < 4 || curve.byteLength > WORKER_FLOCK_AUDIO_MAX_BYTES) return false;
    try { if (new URL(curve.url).protocol !== 'blob:') return false; } catch { return false; }
  }
  return true;
}
