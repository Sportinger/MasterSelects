import type { SceneCutAnalysis } from '../../types/sceneCutAnalysis';
import { readIsobmffMetadata } from '../mediaMetadata/isobmffMetadata';
import {
  createTurboResFrameProvider,
  type TurboResFrameProvider,
} from '../mediaRuntime/prores/TurboResFrameProvider';
import type { TurboResProResFourCC } from '../mediaRuntime/prores/turboResCodecIdentity';
import {
  createHapFrameProvider,
  type HapFrameProvider,
} from '../mediaRuntime/hap/HapFrameProvider';
import type { HapVideoFourCC } from '../hap/hapCodecIdentity';
import { ProxySceneCutAnalyzer } from '../sceneCutDetection/proxySceneCutAnalyzer';
import { JPEG_QUALITY, PROXY_FPS, PROXY_MAX_WIDTH } from './constants';
import { ProxyFrameEncodeWorkerClient } from './frameEncodeWorkerClient';
import { canUseDedicatedFrameWorkers } from './workerCapabilities';

export interface TurboResProxyGenerationOptions {
  analyzeSceneCuts?: boolean;
  sceneCutsOnly?: boolean;
  onSceneCutProgress?: (progress: number) => void;
}

interface TurboResProxyResult {
  frameCount: number;
  fps: number;
  frameIndices: Set<number>;
  sceneCutAnalysis?: SceneCutAnalysis;
  sceneCutError?: string;
}

async function encodeFrameOnMainThread(
  frame: VideoFrame,
  width: number,
  height: number,
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create TurboRes proxy canvas');
  context.drawImage(frame, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('TurboRes proxy JPEG encode failed')),
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}

export async function generateTurboResProxy(params: {
  file: File;
  mediaFileId: string;
  fourCC: TurboResProResFourCC | HapVideoFourCC;
  /** Which session-provider decodes the source; defaults to TurboRes/ProRes. */
  backend?: 'turbores' | 'hap';
  onProgress: (progress: number) => void;
  checkCancelled: () => boolean;
  saveFrame: (frame: { frameIndex: number; blob: Blob }) => Promise<void>;
  existingFrameIndices?: Set<number>;
  options?: TurboResProxyGenerationOptions;
}): Promise<TurboResProxyResult | null> {
  const options = params.options ?? {};
  const metadata = await readIsobmffMetadata(params.file);
  if (!metadata) throw new Error('TurboRes proxy could not read MOV/MP4 metadata');
  const duration = Math.max(0, metadata.duration ?? 0);
  if (!duration) throw new Error('TurboRes proxy source has no usable duration');
  const proxyFps = Math.max(1, Math.min(PROXY_FPS, metadata.fps ?? PROXY_FPS));
  const totalFrames = Math.max(1, Math.ceil(duration * proxyFps));
  const sourceWidth = Math.max(1, metadata.width ?? metadata.codedWidth ?? 1920);
  const sourceHeight = Math.max(1, metadata.height ?? metadata.codedHeight ?? 1080);
  const outputScale = Math.min(1, PROXY_MAX_WIDTH / sourceWidth);
  const outputWidth = Math.max(2, Math.round(sourceWidth * outputScale / 2) * 2);
  const outputHeight = Math.max(2, Math.round(sourceHeight * outputScale / 2) * 2);
  const savedFrameIndices = new Set(params.existingFrameIndices ?? []);
  const analyzeSceneCuts = options.analyzeSceneCuts === true;
  const sceneCutsOnly = options.sceneCutsOnly === true;
  let sceneAnalyzer: ProxySceneCutAnalyzer | null = null;
  let sceneCutError: Error | null = null;
  let provider: TurboResFrameProvider | HapFrameProvider | null = null;
  let encodeWorker: ProxyFrameEncodeWorkerClient | null = null;
  const pendingEncodes = new Set<Promise<void>>();

  try {
    provider = params.backend === 'hap'
      ? await createHapFrameProvider({
        sourceId: `proxy:${params.mediaFileId}`,
        file: params.file,
        fourCC: params.fourCC as HapVideoFourCC,
        policy: 'background',
      })
      : await createTurboResFrameProvider({
        sourceId: `proxy:${params.mediaFileId}`,
        file: params.file,
        fourCC: params.fourCC as TurboResProResFourCC,
        policy: 'background',
      });
    if (!provider?.seekExact) throw new Error('Codec proxy provider failed to initialize');
    if (analyzeSceneCuts) {
      try { sceneAnalyzer = new ProxySceneCutAnalyzer(); }
      catch (error) { sceneCutError = error instanceof Error ? error : new Error(String(error)); }
    }
    if (!sceneCutsOnly && canUseDedicatedFrameWorkers()) {
      encodeWorker = new ProxyFrameEncodeWorkerClient(outputWidth, outputHeight, JPEG_QUALITY);
    }

    const scheduleEncode = (frameIndex: number, frame: VideoFrame): void => {
      const encode = (async () => {
        let ownedFrame: VideoFrame | null = null;
        try {
          if (encodeWorker) {
            ownedFrame = frame.clone();
            const encoded = await encodeWorker.encode(frameIndex, ownedFrame);
            ownedFrame = null;
            await params.saveFrame({ frameIndex, blob: encoded.blob });
          } else {
            const blob = await encodeFrameOnMainThread(frame, outputWidth, outputHeight);
            await params.saveFrame({ frameIndex, blob });
          }
          savedFrameIndices.add(frameIndex);
          params.onProgress(Math.min(100, Math.round(savedFrameIndices.size / totalFrames * 100)));
        } finally {
          try { ownedFrame?.close(); } catch { /* transferred or already closed */ }
        }
      })();
      pendingEncodes.add(encode);
      void encode.then(
        () => pendingEncodes.delete(encode),
        () => pendingEncodes.delete(encode),
      );
    };

    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
      if (params.checkCancelled()) return null;
      const needsProxyFrame = !sceneCutsOnly && !savedFrameIndices.has(frameIndex);
      if (!needsProxyFrame && !analyzeSceneCuts) continue;
      await provider.seekExact(Math.min(frameIndex / proxyFps, duration - 0.001));
      const frame = provider.getCurrentFrame();
      if (!frame) throw new Error(`TurboRes proxy frame ${frameIndex} is unavailable`);

      if (sceneAnalyzer && !sceneCutError) {
        try {
          sceneAnalyzer.analyze(frame);
          await sceneAnalyzer.waitForBackpressure();
          options.onSceneCutProgress?.(Math.min(99, Math.round((frameIndex + 1) / totalFrames * 100)));
        } catch (error) {
          sceneCutError = error instanceof Error ? error : new Error(String(error));
          sceneAnalyzer.dispose();
          sceneAnalyzer = null;
        }
      }
      if (needsProxyFrame) scheduleEncode(frameIndex, frame);
      if (pendingEncodes.size >= 4) await Promise.race(pendingEncodes);
    }

    await Promise.all(pendingEncodes);
    let sceneCutAnalysis: SceneCutAnalysis | undefined;
    if (sceneAnalyzer && !sceneCutError) {
      try {
        sceneCutAnalysis = await sceneAnalyzer.complete(
          duration,
          totalFrames,
          { size: params.file.size, lastModified: params.file.lastModified },
        );
        options.onSceneCutProgress?.(100);
      } catch (error) {
        sceneCutError = error instanceof Error ? error : new Error(String(error));
      }
    }
    return {
      frameCount: savedFrameIndices.size,
      fps: proxyFps,
      frameIndices: savedFrameIndices,
      sceneCutAnalysis,
      sceneCutError: sceneCutError?.message,
    };
  } finally {
    await Promise.allSettled([...pendingEncodes]);
    encodeWorker?.dispose();
    sceneAnalyzer?.dispose();
    await provider?.destroyAsync();
  }
}
