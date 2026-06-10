import { audioGraphPlanStepsToEffectInstances } from '../../../services/audio/audioGraphRouteSettings';
import type { ClipAudioRenderService } from '../../../services/audio/ClipAudioRenderService';
import type { ExportAudioBufferStage } from '../../../services/timeline/exportRuntimeReporting';
import { AudioEffectRenderer } from '../AudioEffectRenderer';
import type { AudioGraphRenderPlan } from '../AudioGraphTypes';
import { appendSilence, getPlanTailSeconds } from './rangePlanning';
import { buildClipRenderProgress, type AudioExportProgressSink } from './progress';
import type { Keyframe } from '../../../types/keyframes';
import type { TimelineClip } from '../../../types/timeline';

export interface RenderExportClipAudioOptions {
  clips: TimelineClip[];
  buffers: Map<string, AudioBuffer>;
  clipKeyframes: Map<string, Keyframe[]>;
  audioGraphPlan: AudioGraphRenderPlan;
  clipAudioRenderer: ClipAudioRenderService;
  graphEffectRenderer: AudioEffectRenderer;
  shouldCancel: () => boolean;
  assertAudioBufferAdmission: (stage: ExportAudioBufferStage, buffer: AudioBuffer, clip?: TimelineClip) => void;
  reportAudioBuffer: (stage: ExportAudioBufferStage, buffer: AudioBuffer, clip?: TimelineClip) => boolean;
  onProgress?: AudioExportProgressSink;
}

export async function renderExportClipAudioEffects(
  options: RenderExportClipAudioOptions,
): Promise<Map<string, AudioBuffer>> {
  const processed = new Map<string, AudioBuffer>();
  const clipPlanById = new Map(options.audioGraphPlan.clips.map(clip => [clip.clipId, clip]));
  const trackPlanById = new Map(options.audioGraphPlan.tracks.map(track => [track.trackId, track]));
  const renderConcurrency = 4;
  let completed = 0;

  const renderOne = async (clip: TimelineClip, index: number): Promise<void> => {
    const buffer = options.buffers.get(clip.id);
    if (!buffer || options.shouldCancel()) return;
    options.assertAudioBufferAdmission('processed-buffer', buffer, clip);

    const keyframes = options.clipKeyframes.get(clip.id) || [];
    const clipPlan = clipPlanById.get(clip.id);
    const clipTailSeconds = getPlanTailSeconds(clipPlan?.effectChain);

    const rendered = await options.clipAudioRenderer.render({
      clip,
      sourceBuffer: buffer,
      keyframes,
      effectTailSeconds: clipTailSeconds,
      onProgress: progress => options.onProgress?.(
        buildClipRenderProgress(clip, index, options.clips.length, progress)
      ),
    });
    if (options.shouldCancel()) return;

    const trackPlan = trackPlanById.get(clip.trackId);
    const trackEffects = audioGraphPlanStepsToEffectInstances(trackPlan?.effectChain);
    const trackInputBuffer = trackEffects.length > 0
      ? appendSilence(rendered.buffer, getPlanTailSeconds(trackPlan?.effectChain))
      : rendered.buffer;
    const trackRenderedBuffer = trackEffects.length > 0
      ? await options.graphEffectRenderer.renderEffectInstances(
        trackInputBuffer,
        trackEffects,
        [],
        trackInputBuffer.duration
      )
      : rendered.buffer;
    if (options.shouldCancel()) return;

    options.assertAudioBufferAdmission('processed-buffer', trackRenderedBuffer, clip);
    processed.set(clip.id, trackRenderedBuffer);
    options.reportAudioBuffer('processed-buffer', trackRenderedBuffer, clip);
    completed += 1;
    options.onProgress?.({
      phase: 'processing',
      percent: Math.round((completed / options.clips.length) * 100),
      currentClip: clip.name,
      message: `Rendering audio: ${clip.name}`,
    });
  };

  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < options.clips.length && !options.shouldCancel()) {
      const index = cursor++;
      await renderOne(options.clips[index], index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(renderConcurrency, options.clips.length) }, () => worker())
  );

  return processed;
}
