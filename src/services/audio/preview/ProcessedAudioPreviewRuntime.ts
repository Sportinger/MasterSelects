import type { Keyframe, TimelineClip } from '../../../types';
import type { AudioSyncState, FrameContext } from '../../layerBuilder/types';
import { useTimelineStore } from '../../../stores/timeline';
import { createTrackLiveAudioRouteSettings } from '../audioGraphRouteSettings';
import { audioRoutingManager } from '../../audioRoutingManager';
import { resolveAudioSyncMedia } from '../../layerBuilder/audioSyncMediaResolver';
import { shouldUseInlineCompositionMixdown } from '../../timeline/compositionAudioClipLinks';
import { clearMasterAudio, playheadState } from '../../layerBuilder/PlayheadState';
import { flagAudioPreviewRetime } from '../../timeline/retime/clipAudioRetime';
import { ProcessedAudioPreviewCache, processedAudioPreviewKey, processedAudioPreviewPosition } from './ProcessedAudioPreviewCache';
import { ProcessedAudioPreviewPlayer } from './ProcessedAudioPreviewPlayer';
import { needsProcessedAudioPreview, previewClipTailSeconds, renderProcessedAudioPreview } from './processedAudioPreviewSource';
import { setProcessedAudioPreviewOwners } from './processedAudioPreviewOwnership';

class ProcessedAudioPreviewRuntime {
  private cache = new ProcessedAudioPreviewCache();
  private player = new ProcessedAudioPreviewPlayer();
  private activeComposition?: string;
  private identities = new WeakMap<object, number>();
  private nextIdentity = 0;
  private revisions = new WeakMap<TimelineClip, { keys: readonly Keyframe[]; media: string; key: string; tail: number; needed: boolean }>();
  private emptyKeys: readonly Keyframe[] = [];

  private identity(value: object | undefined): number | undefined {
    if (!value) return undefined;
    let id = this.identities.get(value);
    if (id === undefined) { id = ++this.nextIdentity; this.identities.set(value, id); }
    return id;
  }

  stopAll(): void { this.player.stopAll(); }
  invalidateAll(): void { this.stopAll(); this.cache.clear(); setProcessedAudioPreviewOwners([]); }

  sync(ctx: FrameContext, state: AudioSyncState): FrameContext {
    if (this.activeComposition !== ctx.activeCompId) {
      this.stopAll();
      this.cache.clear();
      this.activeComposition = ctx.activeCompId;
    }
    // Include external spectral/stem media as well as the clip's own source.
    // Replacing bytes under the same media id must invalidate a prepared render.
    const libraryRevision = JSON.stringify(ctx.mediaFiles.map(file => [file.id, file.fileHash,
      file.url, file.thumbnailUrl, file.audioProxyUrl, file.audioProxyStorageKey, this.identity(file.file)]));
    const revisions = new Map<string, string>();
    const owned = new Set<string>();
    const audible = new Set<string>();
    const ownedTracks = new Set<string>();
    const trackMap = new Map(ctx.tracks.map(track => [track.id, track]));
    for (const clip of ctx.clips) {
      const track = trackMap.get(clip.trackId);
      if (!track || (track.type !== 'audio' && !shouldUseInlineCompositionMixdown(ctx.clips, clip))) continue;
      const rawKeys = ctx.getClipKeyframes?.(clip.id) ?? useTimelineStore.getState().clipKeyframes.get(clip.id);
      const keys = rawKeys?.length ? rawKeys : this.emptyKeys;
      const media = `${ctx.activeCompId}:${libraryRevision}:${this.identity(clip.file)}:${this.identity(clip.source?.file)}`;
      let revision = this.revisions.get(clip);
      if (!revision || revision.keys !== keys || revision.media !== media) {
        revision = { keys, media, key: processedAudioPreviewKey(clip, keys, media),
          tail: previewClipTailSeconds(clip), needed: needsProcessedAudioPreview(clip, keys) };
        this.revisions.set(clip, revision);
      }
      if (!revision.needed) continue;
      revisions.set(clip.id, revision.key);
      owned.add(clip.id);
      const local = ctx.playheadPosition - clip.startTime;
      const active = ctx.clipsByTrackId.get(clip.trackId)?.id === clip.id;
      const tail = this.player.has(clip.id) && local >= clip.duration && local < clip.duration + revision.tail;
      if (!active && !tail) continue;
      if (active) ownedTracks.add(clip.trackId);
      audible.add(clip.id);
      const entry = this.cache.request(clip.id, revision.key, clip.duration + revision.tail,
        signal => renderProcessedAudioPreview(clip, keys, signal));
      const position = processedAudioPreviewPosition(entry, local);
      const mediaSource = resolveAudioSyncMedia(clip);
      for (const element of [mediaSource.htmlAudioElement, clip.mixdownAudio]) {
        if (!element) continue;
        element.muted = true;
        element.pause();
        flagAudioPreviewRetime(element, position.muted ? position.reason : undefined);
        if (playheadState.masterAudioElement === element) clearMasterAudio();
      }
      if (position.muted) { this.player.stop(clip.id); continue; }
      const route = createTrackLiveAudioRouteSettings({ track, masterAudioState: ctx.masterAudioState });
      route.muted ||= clip.audioState?.muted === true || (track.type === 'audio'
        ? !ctx.unmutedAudioTrackIds.has(track.id) : !ctx.visibleVideoTrackIds.has(track.id));
      if (this.player.sync(clip.id, revision.key, position.buffer, position.offset,
        ctx.isPlaying && ctx.playbackSpeed === 1, ctx.isDraggingPlayhead, route)) state.audioPlayingCount++;
      const meter = this.player.meter(clip.id, ctx.now);
      if (meter) useTimelineStore.getState().updateRuntimeAudioMeter(track.id, meter,
        audioRoutingManager.getMasterMeterSnapshot(ctx.now) ?? undefined);
    }
    this.cache.reconcile(revisions);
    // Eviction may have removed a currently playing buffer; do not retain it via a voice.
    this.player.retain(new Set([...audible].filter(id => this.cache.peek(id)?.status === 'ready')));
    setProcessedAudioPreviewOwners(owned);
    if (!owned.size) return ctx;
    return { ...ctx, clipsAtTime: ctx.clipsAtTime.filter(clip => !owned.has(clip.id)),
      clipsByTrackId: new Map([...ctx.clipsByTrackId].filter(([, clip]) => !owned.has(clip.id))),
      audioTracks: ctx.audioTracks.filter(track => !ownedTracks.has(track.id)) };
  }
}

let runtime: ProcessedAudioPreviewRuntime | undefined;
export function getProcessedAudioPreviewRuntime(): ProcessedAudioPreviewRuntime {
  return runtime ??= import.meta.hot?.data?.processedAudioPreviewRuntime ?? new ProcessedAudioPreviewRuntime();
}
if (import.meta.hot) import.meta.hot.dispose(data => {
  runtime?.invalidateAll();
  data.processedAudioPreviewRuntime = runtime;
});
