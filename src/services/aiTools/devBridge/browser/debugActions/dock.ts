import { useDockStore } from '../../../../../stores/dockStore';
import {
  summarizeLongAnimationFrameEntry,
  summarizeNumberList,
  summarizePerformanceMemory,
  summarizeProxyAudioCache,
} from './performance';
import { summarizeElementForDebug } from './interaction';

function collectDockResizeSnapshot() {
  const audioMixer = document.querySelector<HTMLElement>('.audio-mixer-panel');
  const handles = Array.from(document.querySelectorAll<HTMLElement>('.dock-resize-handle'));
  const splits = Array.from(document.querySelectorAll<HTMLElement>('.dock-split')).map((split) => ({
    splitId: split.dataset.splitId ?? null,
    className: split.className,
    rect: summarizeElementForDebug(split)?.rect ?? null,
  }));
  return {
    audioMixer: summarizeElementForDebug(audioMixer),
    handles: handles.map((handle) => summarizeElementForDebug(handle)),
    splits,
    dockLayout: useDockStore.getState().layout,
  };
}

function findDockResizeHandleForDebug(args: Record<string, unknown> = {}): HTMLElement | null {
  const splitId = typeof args.splitId === 'string' && args.splitId.trim()
    ? args.splitId.trim()
    : '';
  if (splitId) {
    const split = document.querySelector<HTMLElement>(`.dock-split[data-split-id="${CSS.escape(splitId)}"]`);
    const handle = split?.querySelector<HTMLElement>(':scope > .dock-resize-handle');
    if (handle) return handle;
  }

  const direction = args.direction === 'horizontal' ? 'horizontal' : 'vertical';
  const handles = Array.from(document.querySelectorAll<HTMLElement>(`.dock-resize-handle.${direction}`));
  if (handles.length === 0) return null;

  const audioMixer = document.querySelector<HTMLElement>('.audio-mixer-panel');
  const audioRect = audioMixer?.getBoundingClientRect();
  if (!audioRect) return handles[0] ?? null;

  return handles
    .map((handle) => {
      const rect = handle.getBoundingClientRect();
      const edgeDistance = direction === 'vertical'
        ? Math.abs(rect.top + rect.height / 2 - audioRect.top)
        : Math.abs(rect.left + rect.width / 2 - audioRect.left);
      return { handle, edgeDistance };
    })
    .sort((left, right) => left.edgeDistance - right.edgeDistance)[0]?.handle ?? null;
}

export async function measureDockResizeInteraction(args: Record<string, unknown> = {}) {
  const durationMs = typeof args.durationMs === 'number' && Number.isFinite(args.durationMs)
    ? Math.max(500, Math.min(60000, Math.round(args.durationMs)))
    : 3500;
  const eventIntervalMs = typeof args.eventIntervalMs === 'number' && Number.isFinite(args.eventIntervalMs)
    ? Math.max(16, Math.min(500, Math.round(args.eventIntervalMs)))
    : 33;
  const deltaMagnitude = typeof args.delta === 'number' && Number.isFinite(args.delta)
    ? Math.max(1, Math.min(800, Math.round(Math.abs(args.delta))))
    : 90;
  const handle = findDockResizeHandleForDebug(args);
  if (!handle) {
    return {
      success: false,
      error: 'Dock resize handle not found.',
      data: {
        snapshot: collectDockResizeSnapshot(),
      },
    };
  }

  const expectedFrameMs = 1000 / 60;
  const startedAt = performance.now();
  const frames: Array<{ elapsedMs: number; deltaMs: number }> = [];
  const longTasks: Array<Record<string, unknown>> = [];
  const longAnimationFrames: Array<Record<string, unknown>> = [];
  const beforeCache = summarizeProxyAudioCache();
  const beforeMemory = summarizePerformanceMemory();
  const beforeSnapshot = collectDockResizeSnapshot();
  const handleRect = handle.getBoundingClientRect();
  const handleIsHorizontal = handle.classList.contains('horizontal');
  const startX = handleRect.left + handleRect.width / 2;
  const startY = handleRect.top + handleRect.height / 2;
  let observer: PerformanceObserver | null = null;
  let animationFrameObserver: PerformanceObserver | null = null;
  let frameId: number | null = null;
  let timerId: number | null = null;
  let previousFrameAt: number | null = null;
  let eventCount = 0;

  if (typeof PerformanceObserver !== 'undefined') {
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.push({
            name: entry.name,
            startTime: Math.round(entry.startTime * 100) / 100,
            durationMs: Math.round(entry.duration * 100) / 100,
            entryType: entry.entryType,
          });
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch {
      observer = null;
    }

    try {
      animationFrameObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longAnimationFrames.push(summarizeLongAnimationFrameEntry(entry, startedAt));
        }
      });
      animationFrameObserver.observe({ entryTypes: ['long-animation-frame'] });
    } catch {
      animationFrameObserver = null;
    }
  }

  const dispatchWindowMouseMove = (clientX: number, clientY: number) => {
    window.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      button: 0,
    }));
  };

  try {
    handle.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      clientX: startX,
      clientY: startY,
      button: 0,
    }));

    timerId = window.setInterval(() => {
      const progress = (eventCount % 24) / 24;
      const wave = Math.sin(progress * Math.PI * 2);
      dispatchWindowMouseMove(
        handleIsHorizontal ? startX + wave * deltaMagnitude : startX,
        handleIsHorizontal ? startY : startY + wave * deltaMagnitude,
      );
      eventCount += 1;
    }, eventIntervalMs);

    await new Promise<void>((resolve) => {
      const tick = (timestamp: number) => {
        if (previousFrameAt !== null) {
          frames.push({
            elapsedMs: Math.round(timestamp - startedAt),
            deltaMs: Math.round((timestamp - previousFrameAt) * 100) / 100,
          });
        }
        previousFrameAt = timestamp;
        if (timestamp - startedAt >= durationMs) {
          resolve();
          return;
        }
        frameId = window.requestAnimationFrame(tick);
      };
      frameId = window.requestAnimationFrame(tick);
    });
  } finally {
    if (timerId !== null) window.clearInterval(timerId);
    dispatchWindowMouseMove(startX, startY);
    window.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      clientX: startX,
      clientY: startY,
      button: 0,
    }));
    if (frameId !== null) window.cancelAnimationFrame(frameId);
    observer?.disconnect();
    animationFrameObserver?.disconnect();
  }

  const deltas = frames.map(frame => frame.deltaMs);
  const droppedFrameEstimate = deltas.reduce((sum, delta) => (
    sum + Math.max(0, Math.round(delta / expectedFrameMs) - 1)
  ), 0);
  const slowFrames = frames.filter(frame => frame.deltaMs > expectedFrameMs * 1.75);
  return {
    success: true,
    data: {
      durationMs,
      eventIntervalMs,
      deltaMagnitude,
      eventCount,
      frameCount: frames.length,
      estimatedFps: Math.round((frames.length / Math.max(1, durationMs / 1000)) * 100) / 100,
      frameDeltaMs: summarizeNumberList(deltas),
      slowFrameCount: slowFrames.length,
      droppedFrameEstimate,
      longTaskCount: longTasks.length,
      longAnimationFrameCount: longAnimationFrames.length,
      longTasks,
      longAnimationFrames,
      beforeMemory,
      afterMemory: summarizePerformanceMemory(),
      beforeCache,
      afterCache: summarizeProxyAudioCache(),
      beforeSnapshot,
      afterSnapshot: collectDockResizeSnapshot(),
      handle: summarizeElementForDebug(handle),
      frames: frames.slice(-240),
    },
  };
}
