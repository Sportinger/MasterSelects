import { resolveClipSourceWindow } from '../../timeline/retime/clipRetime';
import type { Keyframe, TimelineClip } from '../../../types';
import { renderAudioGraph } from '../../../engine/audio/AudioGraphRenderer';
import { getPlanTailSeconds } from '../../../engine/audio/exportPipeline/rangePlanning';
export { needsProcessedAudioPreview } from './processedAudioPreviewPolicy';

export function previewClipTailSeconds(clip: TimelineClip): number {
  const plan = renderAudioGraph({ clips: [clip], tracks: [], mode: 'offline' });
  return getPlanTailSeconds(plan.clips[0]?.effectChain);
}

export async function renderProcessedAudioPreview(clip: TimelineClip, keyframes: readonly Keyframe[], signal: AbortSignal): Promise<AudioBuffer> {
  signal.throwIfAborted();
  // These services reach timeline/media stores. Load only after module evaluation,
  // when a render is requested, never while the playback/store graph initializes.
  const [{ useMediaStore }, { MediaAudioRangeReader }, { ClipAudioRenderService }] = await Promise.all([
    import('../../../stores/mediaStore'),
    import('../../../engine/audio/exportPipeline/MediaAudioRangeReader'),
    import('../ClipAudioRenderService'),
  ]);
  signal.throwIfAborted();
  // Always ask the revision-keyed mixdown service; a legacy clip.mixdownBuffer
  // can still refer to a previous nested-content revision.
  const media = useMediaStore.getState().files.find(file => file.id === (clip.mediaFileId ?? clip.source?.mediaFileId));
  const file = media?.file ?? clip.file ?? clip.source?.file;
  const warpRange = clip.timeRemap?.kind === 'warp' ? resolveClipSourceWindow(clip, 0, clip.duration) : undefined;
  const rangeStart = warpRange?.minSourceTime ?? clip.inPoint;
  const rangeEnd = Math.max(rangeStart + 0.001, warpRange?.maxSourceTime ?? clip.outPoint);
  let ranged: AudioBuffer | undefined;
  if (!clip.isComposition && !clip.audioState?.stemSeparation && file?.size) {
    const reader = new MediaAudioRangeReader(file);
    const cancel = () => reader.dispose();
    signal.addEventListener('abort', cancel, { once: true });
    try { ranged = await reader.read(rangeStart, rangeEnd, signal, 128 * 1024 * 1024); }
    catch (error) {
      signal.throwIfAborted();
      // A short format unsupported by WebCodecs can use the established decoder.
      // Never fall back to a giant full-source decode for a short timeline cut.
      if ((media?.duration ?? clip.source?.naturalDuration ?? Infinity) > 300 ||
        (error instanceof Error && error.message.includes('budget'))) throw error;
    } finally { signal.removeEventListener('abort', cancel); reader.dispose(); }
  }
  const sourceBuffer = ranged ?? (clip.isComposition
    ? (await (await import('../../timeline/compositionAudioMixdownCache')).requestCompositionAudioMixdown(clip))?.buffer
    : file
      ? await (await import('../../../engine/audio/AudioExtractor')).audioExtractor.extractAudio(file)
      : (await (await import('../ClipAudioAnalysisOrchestrator')).prepareClipAudioAnalysisInput({
        clip, keyframes, needsProcessed: false, signal }))?.sourceBuffer);
  signal.throwIfAborted();
  if (!sourceBuffer) throw new Error('No readable source for processed audio preview.');
  return (await new ClipAudioRenderService().render({ clip, keyframes, sourceBuffer, sourceIsClipRange: Boolean(ranged),
    sourceBufferStart: ranged ? Math.floor(rangeStart * ranged.sampleRate) / ranged.sampleRate : undefined,
    effectTailSeconds: previewClipTailSeconds(clip), signal })).buffer;
}
