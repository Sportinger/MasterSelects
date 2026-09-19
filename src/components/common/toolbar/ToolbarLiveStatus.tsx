import { useEffect, useState } from 'react';
import { useStreamStore } from '../../../stores/streamStore';
import type { StreamStoreApi } from '../../../services/liveStream/streamTypes';

function formatUptime(startedAtMs: number | null, nowMs: number): string {
  const seconds = startedAtMs === null ? 0 : Math.max(0, Math.floor((nowMs - startedAtMs) / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * Persistent live-stream indicator in the toolbar: visible in every workspace
 * while a stream is starting, live, or stopping, with uptime and health in
 * the label/tooltip. Clicking focuses the Go Live panel.
 */
export function ToolbarLiveStatus({ onOpen }: { onOpen: () => void }) {
  const phase = useStreamStore((state: StreamStoreApi) => state.status.phase);
  const startedAtMs = useStreamStore((state: StreamStoreApi) => state.status.startedAtMs);
  const droppedFrames = useStreamStore((state: StreamStoreApi) => state.status.stats.droppedFrames);
  const bitrateKbps = useStreamStore((state: StreamStoreApi) => state.status.stats.bitrateKbpsEstimate);
  const [nowMs, setNowMs] = useState(Date.now);

  const live = phase === 'live';
  useEffect(() => {
    if (!live) return;
    const interval = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [live]);

  if (phase !== 'starting' && phase !== 'live' && phase !== 'stopping') return null;

  const label = live ? `LIVE ${formatUptime(startedAtMs, nowMs)}` : 'LIVE';
  const title = live
    ? `Streaming — ${Math.round(bitrateKbps)} kbps, ${droppedFrames} dropped frames`
    : 'Live stream changing state';

  return (
    <button
      className={`toolbar-capture-rec${live ? ' recording' : ''}`}
      onClick={onOpen}
      title={title}
      type="button"
    >
      <span aria-hidden="true" /> {label}
    </button>
  );
}
