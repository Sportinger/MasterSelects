import type { JsonValue } from '../../../signals';
import { withProjectArtifactWriteBatch } from '../../project/projectArtifactWriteBatch';
import type { AudioArtifactStore } from '../AudioArtifactStore';
import { createAudioAnalysisManifestRefFromArtifact } from '../audioAnalysisManifestKeys';
import type { AudioChannelLayout } from '../audioArtifactTypes';
import type { WaveformPyramidStoreRequest, WaveformPyramidGenerationResult } from '../WaveformPyramidGenerator';
import { createWaveformPyramidManifest, encodeWaveformPyramidPackedPayload } from '../waveformPyramidManifest';
import { deterministicHashId, storeWaveformPyramidPayloads } from './payloadEncoding';
import type { WaveformPyramidAnalysisContext, WaveformPyramidAnalysisProgress } from './waveformPyramidAnalysisTypes';

/** Batch only the finished payload and its manifest. Source decoding and
 * worker analysis must never hold the project's save barrier.
 */
export async function persistWaveformPyramid(input: {
  artifactStore: AudioArtifactStore;
  request: WaveformPyramidStoreRequest;
  analyzerVersion: string;
  generatedAt: string;
  packedPayload?: ArrayBuffer;
  channelLayout: AudioChannelLayout;
  context: WaveformPyramidAnalysisContext;
  now: () => string;
  emitProgress: (context: WaveformPyramidAnalysisContext, update: Omit<WaveformPyramidAnalysisProgress,
    'jobId' | 'mediaFileId' | 'sourceFingerprint' | 'cacheKey'>) => void;
  throwIfCancelled: (signal: AbortSignal | undefined, jobId: string) => void;
}): Promise<WaveformPyramidGenerationResult> {
  const packedPayload = input.packedPayload ?? encodeWaveformPyramidPackedPayload(input.request.pyramid);
  return withProjectArtifactWriteBatch(async () => {
    const { request, context, channelLayout } = input;
    const analysisKind = request.kind ?? 'waveform-pyramid';
    const stored = await storeWaveformPyramidPayloads({ ...input, pyramid: request.pyramid, packedPayload });
    const manifest = createWaveformPyramidManifest({
      mediaFileId: request.mediaFileId, sourceFingerprint: request.sourceFingerprint,
      clipAudioStateHash: request.clipAudioStateHash, sampleRate: request.pyramid.sampleRate,
      channelLayout, duration: request.pyramid.duration, levels: stored.levels,
      payloadLayout: 'packed-pyramid', packedPayload: stored.packedPayload,
    });
    const artifactId = await deterministicHashId(`audio:${analysisKind}`, context.cacheKey);
    input.emitProgress(context, { phase: 'storing-manifest', percent: 98,
      timestamp: input.now(), message: 'Storing waveform pyramid manifest' });
    input.throwIfCancelled(context.signal, context.jobId);
    const parsedTimestamp = Date.parse(input.generatedAt);
    const artifactResult = await input.artifactStore.putAnalysisArtifact({
      id: artifactId, kind: analysisKind, mediaFileId: request.mediaFileId,
      sourceFingerprint: request.sourceFingerprint, clipAudioStateHash: request.clipAudioStateHash,
      decoderId: request.decoderId ?? 'audio-buffer', decoderVersion: request.decoderVersion ?? '1.0.0',
      analyzerVersion: input.analyzerVersion, sampleRate: request.pyramid.sampleRate,
      channelLayout, duration: request.pyramid.duration, payloadRefs: stored.payloadRefs,
      createdAt: Number.isFinite(parsedTimestamp) ? parsedTimestamp : Date.now(), stale: false,
      warnings: stored.warnings.length > 0 ? stored.warnings : undefined,
      metadata: { ...(request.metadata ?? {}), analysisKind, cacheKey: context.cacheKey,
        waveformManifest: manifest as unknown as JsonValue },
    });
    input.emitProgress(context, { phase: 'complete', percent: 100,
      timestamp: input.now(), message: 'Waveform pyramid storage complete' });
    return {
      jobId: context.jobId, cacheKey: context.cacheKey,
      analysisRef: createAudioAnalysisManifestRefFromArtifact(artifactResult.artifact),
      artifact: artifactResult.artifact, manifest, pyramid: request.pyramid,
      payloadRefs: stored.payloadRefs, warnings: stored.warnings,
    };
  });
}
