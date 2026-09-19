// One-shot HAP frame decode for thumbnails, filmstrips, and probes.
// Owns a short-lived provider and returns an owned VideoFrame clone.

import type { HapVideoFourCC } from '../../hap/hapCodecIdentity';
import {
  createHapFrameProvider,
  type HapFrameProviderOptions,
} from './HapFrameProvider';

export interface DecodeHapOneFrameOptions {
  readonly timeoutMs?: number;
  readonly providerOptions?: Partial<Pick<HapFrameProviderOptions, 'packetSourceFactory'>>;
}

/** Decode one independently addressable HAP packet and return an owned clone. */
export async function decodeHapOneFrame(
  file: File,
  fourCC: HapVideoFourCC,
  timeSeconds: number,
  options: DecodeHapOneFrameOptions = {},
): Promise<VideoFrame> {
  let resolveFrame!: () => void;
  let rejectFrame!: (error: Error) => void;
  const frameReady = new Promise<void>((resolve, reject) => {
    resolveFrame = resolve;
    rejectFrame = reject;
  });
  void frameReady.catch(() => undefined);
  const provider = await createHapFrameProvider({
    sourceId: `hap-one-frame:${file.name}:${file.size}`,
    file,
    fourCC,
    policy: 'background',
    ...options.providerOptions,
    onFrame: resolveFrame,
    onError: rejectFrame,
  });
  if (!provider) {
    throw new Error(`HAP could not initialize ${fourCC} one-frame decode`);
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    provider.seek(Math.max(0, timeSeconds));
    await Promise.race([
      frameReady,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`HAP one-frame decode timed out after ${options.timeoutMs ?? 8_000}ms`)),
          options.timeoutMs ?? 8_000,
        );
      }),
    ]);
    const frame = provider.getCurrentFrame();
    if (!frame) {
      throw new Error(`HAP produced no frame at ${timeSeconds.toFixed(3)}s`);
    }
    return frame.clone();
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
    await provider.destroyAsync();
  }
}
