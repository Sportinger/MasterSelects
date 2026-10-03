import type { Keyframe, TimelineClip } from '../../../types';

/** Complete render-input identity, deliberately including output gain automation. */
export function processedAudioPreviewKey(clip: TimelineClip, keyframes: readonly Keyframe[], mediaRevision: string): string {
  return JSON.stringify({ version: 1, mediaRevision, mediaFileId: clip.mediaFileId,
    sourceMediaFileId: clip.source?.mediaFileId, sourceType: clip.source?.type, isComposition: clip.isComposition, compositionId: clip.compositionId,
    nestedContentHash: clip.nestedContentHash, inPoint: clip.inPoint, outPoint: clip.outPoint,
    naturalDuration: clip.source?.naturalDuration, timeRemap: clip.timeRemap, duration: clip.duration, speed: clip.speed, reversed: clip.reversed,
    preservesPitch: clip.preservesPitch, videoInspectorSections: clip.videoInspectorSections,
    transitionSourceMap: clip.transitionSourceMap, transitionSourceHold: clip.transitionSourceHold,
    transitionSourceTimeOverride: clip.transitionSourceTimeOverride,
    audioState: clip.audioState, effects: clip.effects, keyframes });
}

export interface ProcessedAudioPreviewEntry {
  key: string;
  status: 'pending' | 'ready' | 'error';
  buffer?: AudioBuffer;
  reason?: string;
}
type RenderPreview = (signal: AbortSignal) => Promise<AudioBuffer>;
interface Entry extends ProcessedAudioPreviewEntry {
  controller: AbortController;
  render?: RenderPreview;
  seconds: number;
  bytes: number;
  started: boolean;
}

/** Serial preparation; LRU limits cover queued reservations and completed PCM. */
export class ProcessedAudioPreviewCache {
  private entries = new Map<string, Entry>();
  private running = false;
  private readonly limits: { maxClips: number; maxSeconds: number; maxBytes: number };
  constructor(limits = { maxClips: 8, maxSeconds: 300, maxBytes: 128 * 1024 * 1024 }) { this.limits = limits; }

  request(id: string, key: string, seconds: number, render: RenderPreview): ProcessedAudioPreviewEntry {
    const previous = this.entries.get(id);
    if (previous?.key === key) {
      this.entries.delete(id);
      this.entries.set(id, previous);
      return previous;
    }
    this.invalidate(id);
    const entry: Entry = { key, status: 'pending', seconds, bytes: seconds * 48000 * 2 * 4,
      controller: new AbortController(), render, started: false };
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > this.limits.maxSeconds || entry.bytes > this.limits.maxBytes) {
      return { key, status: 'error', reason: 'Processed audio exceeds the preview cache budget.' };
    }
    this.entries.set(id, entry);
    this.evict(id);
    this.pump();
    return entry;
  }

  peek(id: string): ProcessedAudioPreviewEntry | undefined { return this.entries.get(id); }

  invalidate(id: string): void {
    this.entries.get(id)?.controller.abort();
    this.entries.delete(id);
  }

  reconcile(revisions: ReadonlyMap<string, string>): void {
    for (const [id, entry] of this.entries) if (revisions.get(id) !== entry.key) this.invalidate(id);
  }

  clear(): void { for (const id of this.entries.keys()) this.invalidate(id); }

  private evict(protectedId: string): void {
    const exceedsBudget = () => {
      let seconds = 0, bytes = 0;
      for (const entry of this.entries.values()) { seconds += entry.seconds; bytes += entry.bytes; }
      return this.entries.size > this.limits.maxClips || seconds > this.limits.maxSeconds || bytes > this.limits.maxBytes;
    };
    for (const id of this.entries.keys()) {
      if (!exceedsBudget()) break;
      if (id !== protectedId) this.invalidate(id);
    }
  }

  private pump(): void {
    if (this.running) return;
    const next = [...this.entries].find(([, entry]) => entry.status === 'pending' && !entry.started);
    if (!next) return;
    const [id, entry] = next;
    this.running = entry.started = true;
    const render = entry.render!;
    entry.render = undefined; // Do not retain source clips/Files/mixdowns in ready entries.
    void Promise.resolve().then(() => {
      entry.controller.signal.throwIfAborted();
      return render(entry.controller.signal);
    }).then(buffer => {
      if (entry.controller.signal.aborted || this.entries.get(id) !== entry) return;
      const bytes = buffer.length * buffer.numberOfChannels * 4;
      if (buffer.duration > this.limits.maxSeconds || bytes > this.limits.maxBytes) {
        throw new Error('Processed audio exceeds the preview cache budget.');
      }
      entry.buffer = buffer;
      entry.bytes = bytes;
      entry.seconds = buffer.duration;
      entry.status = 'ready';
      this.evict(id);
    }).catch(error => {
      if (entry.controller.signal.aborted || this.entries.get(id) !== entry) return;
      entry.status = 'error';
      entry.reason = error instanceof Error ? error.message : String(error);
      entry.seconds = entry.bytes = 0;
    }).finally(() => {
      // An uncancellable decode/effect stage must settle before starting another.
      this.running = false;
      this.pump();
    });
  }
}

export function processedAudioPreviewPosition(entry: ProcessedAudioPreviewEntry, localTime: number) {
  return entry.status === 'ready' && entry.buffer && localTime >= 0 && localTime < entry.buffer.duration
    ? { muted: false as const, offset: localTime, buffer: entry.buffer }
    : { muted: true as const, reason: entry.reason ?? 'Preparing retimed audio; source playback is muted.' };
}
