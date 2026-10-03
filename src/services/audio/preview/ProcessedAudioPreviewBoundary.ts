import type { TimelineClip } from '../../../types';
import type { AudioSyncState, FrameContext } from '../../layerBuilder/types';
import type { AudioSyncMediaResolution } from '../../layerBuilder/audioSyncMediaResolver';
import { clearMasterAudio, playheadState } from '../../layerBuilder/PlayheadState';
import { shouldUseInlineCompositionMixdown } from '../../timeline/compositionAudioClipLinks';
import { flagAudioPreviewRetime } from '../../timeline/retime/clipAudioRetime';
import { needsProcessedAudioPreview } from './processedAudioPreviewPolicy';
import { setProcessedAudioPreviewOwners } from './processedAudioPreviewOwnership';

interface PreviewRuntime {
  sync(ctx: FrameContext, state: AudioSyncState): FrameContext;
  stopAll(): void;
  invalidateAll(): void;
}
type ResolveMedia = (clip: TimelineClip) => AudioSyncMediaResolution;

/** No static edge from playback/store initialization into the preview runtime. */
export class ProcessedAudioPreviewBoundary {
  private runtime?: PreviewRuntime;
  private loading?: Promise<void>;
  private failure?: string;
  private readonly load: () => Promise<PreviewRuntime>;

  constructor(load: () => Promise<PreviewRuntime> = async () =>
    (await import('./ProcessedAudioPreviewRuntime')).getProcessedAudioPreviewRuntime()) {
    this.load = load;
  }

  stopAll(): void { this.runtime?.stopAll(); }
  invalidateAll(): void { this.runtime?.invalidateAll(); setProcessedAudioPreviewOwners([]); }

  sync(ctx: FrameContext, state: AudioSyncState, resolveMedia: ResolveMedia): FrameContext {
    if (this.runtime) return this.runtime.sync(ctx, state);
    const tracks = new Map(ctx.tracks.map(track => [track.id, track]));
    const owned = new Set<string>();
    const ownedTracks = new Set<string>();
    for (const clip of ctx.clips) {
      const track = tracks.get(clip.trackId);
      if (!track || (track.type !== 'audio' && !shouldUseInlineCompositionMixdown(ctx.clips, clip))) continue;
      if (!needsProcessedAudioPreview(clip, ctx.getClipKeyframes?.(clip.id) ?? [])) continue;
      owned.add(clip.id);
      if (ctx.clipsByTrackId.get(clip.trackId)?.id !== clip.id) continue;
      ownedTracks.add(clip.trackId);
      for (const element of [resolveMedia(clip).htmlAudioElement, clip.mixdownAudio]) {
        if (!element) continue;
        element.muted = true;
        element.pause();
        flagAudioPreviewRetime(element, this.failure ?? 'Processed audio preview is preparing.');
        if (playheadState.masterAudioElement === element) clearMasterAudio();
      }
    }
    setProcessedAudioPreviewOwners(owned);
    if (!owned.size) return ctx;
    // Completion never starts playback; the next frame supplies fresh timeline state.
    this.loading ??= this.load().then(runtime => { this.runtime = runtime; }, () => {
      this.failure = 'Processed audio preview could not load; source playback remains muted.';
    });
    return { ...ctx, clipsAtTime: ctx.clipsAtTime.filter(clip => !owned.has(clip.id)),
      clipsByTrackId: new Map([...ctx.clipsByTrackId].filter(([, clip]) => !owned.has(clip.id))),
      audioTracks: ctx.audioTracks.filter(track => !ownedTracks.has(track.id)) };
  }
}

let boundary: ProcessedAudioPreviewBoundary | undefined;
function getBoundary(): ProcessedAudioPreviewBoundary {
  return boundary ??= import.meta.hot?.data?.processedAudioPreviewBoundary ?? new ProcessedAudioPreviewBoundary();
}
export const processedAudioPreviewRuntime = {
  stopAll: () => getBoundary().stopAll(),
  sync: (ctx: FrameContext, state: AudioSyncState, resolveMedia: ResolveMedia) =>
    getBoundary().sync(ctx, state, resolveMedia),
};
if (import.meta.hot) import.meta.hot.dispose(data => {
  boundary?.invalidateAll();
  data.processedAudioPreviewBoundary = boundary;
});
