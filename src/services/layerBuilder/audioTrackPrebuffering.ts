import type { TimelineClip } from '../../types';
import type { FrameContext } from './types';
import type { AudioTrackStemBufferMixerManager } from './audioTrackStemBufferMixers';
import type { AudioTrackStemPreviewElementManager } from './audioTrackStemPreviewElements';
import {
  getAudibleStemLayers,
  usesSourceAudioLayer,
} from './audioTrackStemSyncModel';

const AUDIO_LOOKAHEAD_TIME = 1.0;

type AudioTrackPrebufferManagerOptions = {
  getAudioProxyElementForClip: (clip: TimelineClip) => HTMLAudioElement | null;
  getClipAudioElement: (clip: TimelineClip) => HTMLAudioElement | null;
  stemBufferMixers: AudioTrackStemBufferMixerManager;
  stemPreviewElements: AudioTrackStemPreviewElementManager;
  /** Clips whose element a crossfade positioned at its earlier start this frame. */
  isPreparedElsewhere?: (clipId: string) => boolean;
};

export class AudioTrackPrebufferManager {
  private preBufferedAudio = new WeakSet<HTMLAudioElement>();
  private getAudioProxyElementForClip: (clip: TimelineClip) => HTMLAudioElement | null;
  private getClipAudioElement: (clip: TimelineClip) => HTMLAudioElement | null;
  private stemBufferMixers: AudioTrackStemBufferMixerManager;
  private stemPreviewElements: AudioTrackStemPreviewElementManager;
  private isPreparedElsewhere: (clipId: string) => boolean;

  constructor(options: AudioTrackPrebufferManagerOptions) {
    this.getAudioProxyElementForClip = options.getAudioProxyElementForClip;
    this.getClipAudioElement = options.getClipAudioElement;
    this.stemBufferMixers = options.stemBufferMixers;
    this.stemPreviewElements = options.stemPreviewElements;
    this.isPreparedElsewhere = options.isPreparedElsewhere ?? (() => false);
  }

  preBufferUpcomingAudio(ctx: FrameContext): void {
    if (!ctx.isPlaying || ctx.isDraggingPlayhead) return;

    const lookaheadEnd = ctx.playheadPosition + AUDIO_LOOKAHEAD_TIME;

    for (const clip of ctx.clips) {
      if (!clip.source || this.isPreparedElsewhere(clip.id)) continue;
      if (clip.startTime <= ctx.playheadPosition || clip.startTime > lookaheadEnd) continue;

      const stemSeparation = clip.audioState?.stemSeparation;
      const audibleStemLayers = getAudibleStemLayers(stemSeparation);
      const sourceLayerIsAudible = usesSourceAudioLayer(stemSeparation);
      const shouldUseStemBufferLookahead = Boolean(
        stemSeparation &&
        audibleStemLayers.length > 0 &&
        !sourceLayerIsAudible &&
        this.stemBufferMixers.canUseForStemSet(stemSeparation, audibleStemLayers),
      );
      if (shouldUseStemBufferLookahead) {
        for (const stem of audibleStemLayers) this.stemBufferMixers.requestStemLayerBuffer(stem);
      }

      const stemElements = audibleStemLayers.length > 0 && !shouldUseStemBufferLookahead
        ? this.stemPreviewElements.getStemAudioElements(clip)
        : null;
      const sourceAudioElement = usesSourceAudioLayer(stemSeparation)
        ? this.getAudioProxyElementForClip(clip) ?? this.getClipAudioElement(clip)
        : null;
      const audioElements = [
        ...(sourceAudioElement ? [sourceAudioElement] : []),
        ...(stemElements
          ? audibleStemLayers
              .map(stem => stemElements.get(stem.id)?.element)
              .filter((element): element is HTMLAudioElement => Boolean(element))
          : []),
      ];

      for (const audio of audioElements) {
        if (this.preBufferedAudio.has(audio)) continue;
        if (!audio.src && audio.readyState === 0) continue;
        // A playing element is in use (a crossfade's incoming sound starts before its clip): never move it.
        if (!audio.paused) continue;
        if (Math.abs(audio.currentTime - clip.inPoint) > 0.1) audio.currentTime = clip.inPoint;
        this.preBufferedAudio.add(audio);
      }
    }
  }
}
