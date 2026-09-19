// Memory Leak extra controls: heap status, feed the clip's media through
// FFmpeg, reshuffle the block, and freeze/unfreeze the current block as a
// project artifact so preview and later sessions render the same bytes.

import { useEffect, useState } from 'react';
import type { EffectControlProps } from '../../types';
import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import { memoryLeakHeapSource, MEMORY_FEED_SECONDS, type MemoryLeakSourceState } from './heapSource';
import { buildMemoryWindow } from './memorySource';
import { depthParam } from './memoryWindow';

const MEBIBYTE = 1024 * 1024;

function formatMegabytes(bytes: number): string {
  return `${(bytes / MEBIBYTE).toFixed(bytes >= 100 * MEBIBYTE ? 0 : 1)} MB`;
}

function describeHeap(state: MemoryLeakSourceState, snapshotState: string, frozen: boolean): string {
  if (frozen) {
    if (snapshotState === 'ready') return 'Frozen block from project storage';
    if (snapshotState === 'missing') return 'Frozen block is missing from storage';
    return 'Loading frozen block…';
  }
  if (state.status === 'error') return `FFmpeg core failed: ${state.error ?? 'unknown error'}`;
  if (state.status === 'loading' || state.status === 'idle') return 'Loading FFmpeg core…';
  const feed = state.lastFeed ? ` · fed ${state.lastFeed.label}` : ' · not fed yet';
  return `FFmpeg heap ${formatMegabytes(state.usedBytes)} used of ${formatMegabytes(state.heapBytes)} · run ${state.epoch}${feed}`;
}

export function MemoryLeakControls({ params, onChange, clipId }: EffectControlProps) {
  const [state, setState] = useState<MemoryLeakSourceState>(() => memoryLeakHeapSource.getState());
  const [busy, setBusy] = useState<'feed' | 'freeze' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const clip = useTimelineStore((store) => store.clips.find((candidate) => candidate.id === clipId));
  const mediaFileId = clip?.mediaFileId || clip?.source?.mediaFileId;
  const mediaFile = useMediaStore((store) => store.files.find((file) => file.id === mediaFileId));
  const snapshot = typeof params.snapshot === 'string' ? params.snapshot : '';
  const frozen = snapshot.length > 0;

  useEffect(() => {
    memoryLeakHeapSource.ensureLoaded();
    return memoryLeakHeapSource.subscribe(() => setState(memoryLeakHeapSource.getState()));
  }, []);

  const heapReady = state.status === 'ready' && state.heapBytes > 0;
  const canFeed = heapReady && !!mediaFile && !state.feeding && busy === null && !frozen;

  const feed = async () => {
    if (!mediaFile) return;
    setBusy('feed');
    setMessage(null);
    try {
      const blob: Blob = mediaFile.file ? mediaFile.file : await (await fetch(mediaFile.url)).blob();
      await memoryLeakHeapSource.feedFromMedia(blob, mediaFile.name, MEMORY_FEED_SECONDS);
      setMessage(`Decoded ${MEMORY_FEED_SECONDS}s of ${mediaFile.name} into memory`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const reshuffle = () => {
    const heapMegabytes = Math.max(0.0625, state.usedBytes / MEBIBYTE);
    onChange({
      ...params,
      offset: Math.round(Math.random() * heapMegabytes * 100) / 100,
      seed: Math.floor(Math.random() * 10000),
    });
  };

  const freeze = async () => {
    setBusy('freeze');
    setMessage(null);
    try {
      const composition = useMediaStore.getState().getActiveComposition();
      const width = composition?.width ?? 1920;
      const height = composition?.height ?? 1080;
      // Effects receive clip-local media time, so freeze the block for that frame.
      const playhead = useTimelineStore.getState().playheadPosition;
      const time = clip ? Math.max(0, playhead - clip.startTime + (clip.inPoint ?? 0)) : playhead;
      const window = buildMemoryWindow(params, width, height, time);
      if (!window) {
        setMessage('No memory block available to freeze yet');
        return;
      }
      const artifactId = await memoryLeakHeapSource.freezeWindow(window.data, {
        depth: depthParam(params),
        blockWidth: window.plan.memWidth,
        rows: window.plan.memRows,
        sourceOffset: window.offset,
        sourceKey: window.source.key,
      });
      onChange({ ...params, snapshot: artifactId });
      setMessage(`Froze ${formatMegabytes(window.data.byteLength)} of memory`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const unfreeze = () => {
    onChange({ ...params, snapshot: '' });
    setMessage(null);
  };

  return (
    <div className="memory-leak-controls">
      <div className="memory-leak-status">
        {describeHeap(state, frozen ? memoryLeakHeapSource.snapshotStatus(snapshot) : 'unknown', frozen)}
      </div>
      <div className="memory-leak-actions">
        <button
          type="button"
          className="btn btn-sm"
          disabled={!canFeed}
          onClick={() => void feed()}
          title={mediaFile ? `Decode ${MEMORY_FEED_SECONDS}s of ${mediaFile.name} inside FFmpeg so its frames land in the heap` : 'Select a clip with media to feed'}
        >
          {busy === 'feed' || state.feeding ? 'Feeding…' : 'Feed Clip'}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={!heapReady || frozen || busy !== null}
          onClick={reshuffle}
          title="Jump to a random offset and seed"
        >
          Reshuffle
        </button>
        {frozen ? (
          <button type="button" className="btn btn-sm" onClick={unfreeze} disabled={busy !== null} title="Return to the live FFmpeg heap">
            Unfreeze
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-sm"
            disabled={!heapReady || busy !== null}
            onClick={() => void freeze()}
            title="Store the current block in the project so it renders the same in every session"
          >
            {busy === 'freeze' ? 'Freezing…' : 'Freeze'}
          </button>
        )}
      </div>
      {message && <div className="memory-leak-message">{message}</div>}
    </div>
  );
}

export default MemoryLeakControls;
