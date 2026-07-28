import type { TimelineClip } from '../../types';
import { audioRoutingManager } from '../audioRoutingManager';
import { Logger } from '../logger';
import { clearMasterAudio, playheadState } from './PlayheadState';
import { getClipForTrack } from './FrameContext';
import type { FrameContext } from './types';
import { pauseAudioElement } from './audioTrackElementUtils';
import { clipUsesSourceAudioLayer } from './audioTrackStemSyncModel';

const log = Logger.create('CutTransition');

export interface AudioTrackHandoffState {
  clipId: string;
  fileId: string;
  file: File;
  audioElement: HTMLAudioElement;
  outPoint: number;
}

type GetClipAudioElement = (clip: TimelineClip) => HTMLAudioElement | null;
type GetClipSourceMediaFileId = (clip: TimelineClip) => string | undefined;

export class AudioTrackHandoffManager {
  private lastTrackState = new Map<string, AudioTrackHandoffState>();
  private handoffs = new Map<string, HTMLAudioElement>();
  private handoffElements = new Set<HTMLAudioElement>();

  reset(): void {
    this.lastTrackState.clear();
    this.handoffs.clear();
    this.handoffElements.clear();
  }

  hasHandoffElement(audio: HTMLAudioElement): boolean {
    return this.handoffElements.has(audio);
  }

  getRetainedAudioElements(): ReadonlySet<HTMLAudioElement> {
    return this.handoffElements;
  }

  getHandoffAudioElement(clipId: string): HTMLAudioElement | null {
    return this.handoffs.get(clipId) ?? null;
  }

  compute(
    ctx: FrameContext,
    getClipAudioElement: GetClipAudioElement,
    getClipSourceMediaFileId: GetClipSourceMediaFileId
  ): void {
    this.handoffs.clear();
    this.handoffElements.clear();
    if (ctx.isDraggingPlayhead) return;

    for (const track of ctx.audioTracks) {
      const clip = getClipForTrack(ctx, track.id);
      if (!clip?.source || !clipUsesSourceAudioLayer(clip)) continue;

      const currentAudioElement = getClipAudioElement(clip);
      if (!currentAudioElement) continue;

      const prev = this.lastTrackState.get(track.id);
      if (!prev) continue;

      const clipFileId = getClipSourceMediaFileId(clip) || '';
      if (prev.clipId === clip.id) {
        if (clipFileId !== prev.fileId) {
          pauseAudioElement(prev.audioElement);
          audioRoutingManager.removeRoute(prev.audioElement);
          if (playheadState.masterAudioElement === prev.audioElement) {
            clearMasterAudio();
          }
          continue;
        }

        if (prev.audioElement !== currentAudioElement) {
          this.setHandoff(clip.id, prev.audioElement);
        }
        continue;
      }

      const sameSource = clipFileId
        ? clipFileId === prev.fileId
        : clip.file === prev.file;
      if (!sameSource) {
        log.debug('Audio handoff SKIP: different source', { track: track.id });
        continue;
      }

      const inOutGap = Math.abs(clip.inPoint - prev.outPoint);
      if (inOutGap > 0.1) {
        log.debug('Audio handoff SKIP: non-continuous', { gap: inOutGap.toFixed(3) });
        continue;
      }

      const elemDrift = Math.abs(prev.audioElement.currentTime - clip.inPoint);
      if (elemDrift > 0.5) {
        log.debug('Audio handoff SKIP: element too far', {
          elementTime: prev.audioElement.currentTime.toFixed(3),
          inPoint: clip.inPoint.toFixed(3),
          drift: elemDrift.toFixed(3),
        });
        continue;
      }

      log.info('Audio handoff START', {
        track: track.id.slice(-6),
        prevClip: prev.clipId.slice(-6),
        newClip: clip.id.slice(-6),
        drift: elemDrift.toFixed(3),
      });
      this.setHandoff(clip.id, prev.audioElement);
    }
  }

  updateLastTrackState(
    ctx: FrameContext,
    getClipAudioElement: GetClipAudioElement,
    getClipSourceMediaFileId: GetClipSourceMediaFileId
  ): void {
    for (const track of ctx.audioTracks) {
      const clip = getClipForTrack(ctx, track.id);
      if (!clip?.source || !clipUsesSourceAudioLayer(clip)) {
        this.lastTrackState.delete(track.id);
        continue;
      }

      const currentAudioElement = getClipAudioElement(clip);
      if (!currentAudioElement) continue;

      const handoffElement = this.handoffs.get(clip.id);
      const audio = handoffElement ?? currentAudioElement;
      this.lastTrackState.set(track.id, {
        clipId: clip.id,
        fileId: getClipSourceMediaFileId(clip) || '',
        file: clip.file,
        audioElement: audio,
        outPoint: clip.outPoint,
      });
    }
  }

  private setHandoff(clipId: string, audio: HTMLAudioElement): void {
    this.handoffs.set(clipId, audio);
    this.handoffElements.add(audio);
  }
}
