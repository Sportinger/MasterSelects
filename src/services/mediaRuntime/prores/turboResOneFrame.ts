import type { TurboResProResFourCC } from './turboResCodecIdentity';
import {
  createTurboResFrameProvider,
  type TurboResFrameProviderOptions,
} from './TurboResFrameProvider';

export interface DecodeTurboResOneFrameOptions {
  readonly timeoutMs?: number;
  readonly providerOptions?: Partial<Pick<
    TurboResFrameProviderOptions,
    'allowedOutputFormats' | 'concurrency' | 'moduleLoader' | 'outputFormatProbe' |
    'packetSourceFactory' | 'useSharedMemory'
  >>;
}

/** Decode one independently addressable ProRes packet and return an owned clone. */
export async function decodeTurboResOneFrame(
  file: File,
  fourCC: TurboResProResFourCC,
  timeSeconds: number,
  options: DecodeTurboResOneFrameOptions = {},
): Promise<VideoFrame> {
  let resolveFrame!: () => void;
  let rejectFrame!: (error: Error) => void;
  const frameReady = new Promise<void>((resolve, reject) => {
    resolveFrame = resolve;
    rejectFrame = reject;
  });
  void frameReady.catch(() => undefined);
  const provider = await createTurboResFrameProvider({
    sourceId: `one-frame:${file.name}:${file.size}`,
    file,
    fourCC,
    policy: 'background',
    concurrency: 1,
    ...options.providerOptions,
    onFrame: resolveFrame,
    onError: rejectFrame,
  });
  if (!provider) {
    throw new Error(`TurboRes could not initialize ${fourCC} one-frame decode`);
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    provider.seek(Math.max(0, timeSeconds));
    await Promise.race([
      frameReady,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`TurboRes one-frame decode timed out after ${options.timeoutMs ?? 8_000}ms`)),
          options.timeoutMs ?? 8_000,
        );
      }),
    ]);
    const frame = provider.getCurrentFrame();
    if (!frame) {
      throw new Error(`TurboRes produced no frame at ${timeSeconds.toFixed(3)}s`);
    }
    return frame.clone();
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
    await provider.destroyAsync();
  }
}
