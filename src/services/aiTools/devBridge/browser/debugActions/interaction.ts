import { useTimelineStore } from '../../../../../stores/timeline';
import {
  summarizeNumberList,
  summarizePerformanceMemory,
  summarizeProxyAudioCache,
} from './performance';

export function summarizeElementForDebug(element: Element | null) {
  if (!element) return null;
  const htmlElement = element as HTMLElement;
  const rect = htmlElement.getBoundingClientRect();
  return {
    tagName: htmlElement.tagName.toLowerCase(),
    className: htmlElement.className,
    dataAiId: htmlElement.getAttribute('data-ai-id'),
    dataSectionKind: htmlElement.getAttribute('data-section-kind'),
    clientWidth: htmlElement.clientWidth,
    clientHeight: htmlElement.clientHeight,
    scrollWidth: htmlElement.scrollWidth,
    scrollHeight: htmlElement.scrollHeight,
    scrollLeft: htmlElement.scrollLeft,
    scrollTop: htmlElement.scrollTop,
    transform: getComputedStyle(htmlElement).transform,
    rect: {
      x: Math.round(rect.x * 100) / 100,
      y: Math.round(rect.y * 100) / 100,
      width: Math.round(rect.width * 100) / 100,
      height: Math.round(rect.height * 100) / 100,
    },
  };
}

export function collectTimelineInteractionSnapshot() {
  const tracks = document.querySelector<HTMLElement>('[data-ai-id="timeline-tracks"]');
  const bodyContent = document.querySelector<HTMLElement>('.timeline-body-content');
  const audioSection = document.querySelector<HTMLElement>('.timeline-track-section[data-section-kind="audio"]');
  const videoSection = document.querySelector<HTMLElement>('.timeline-track-section[data-section-kind="video"]');
  const audioViewport = audioSection?.querySelector<HTMLElement>('.timeline-section-viewport') ?? null;
  const videoViewport = videoSection?.querySelector<HTMLElement>('.timeline-section-viewport') ?? null;
  const audioContent = audioSection?.querySelector<HTMLElement>('.timeline-section-content-row') ?? null;
  const videoContent = videoSection?.querySelector<HTMLElement>('.timeline-section-content-row') ?? null;
  const audioLanes = audioSection?.querySelector<HTMLElement>('.track-lanes-scroll') ?? null;
  const videoLanes = videoSection?.querySelector<HTMLElement>('.track-lanes-scroll') ?? null;
  return {
    tracks: summarizeElementForDebug(tracks),
    bodyContent: summarizeElementForDebug(bodyContent),
    audioSection: summarizeElementForDebug(audioSection),
    videoSection: summarizeElementForDebug(videoSection),
    audioViewport: summarizeElementForDebug(audioViewport),
    videoViewport: summarizeElementForDebug(videoViewport),
    audioContent: summarizeElementForDebug(audioContent),
    videoContent: summarizeElementForDebug(videoContent),
    audioLanes: summarizeElementForDebug(audioLanes),
    videoLanes: summarizeElementForDebug(videoLanes),
    guidedScrollX: tracks?.getAttribute('data-guided-timeline-scroll-x') ?? null,
    zoom: tracks?.getAttribute('data-guided-timeline-zoom') ?? null,
  };
}

function getTimelineInteractionTarget(kind: string, sectionKind: 'audio' | 'video') {
  const section = document.querySelector<HTMLElement>(`.timeline-track-section[data-section-kind="${sectionKind}"]`);
  const bodyContent = document.querySelector<HTMLElement>('.timeline-body-content');
  if (kind === 'vertical-wheel') {
    return section?.querySelector<HTMLElement>('.timeline-section-viewport') ?? section ?? bodyContent;
  }
  if (kind === 'pointer-move') {
    return bodyContent ?? section?.querySelector<HTMLElement>('.timeline-section-tracks') ?? section;
  }
  return section?.querySelector<HTMLElement>('.timeline-section-tracks') ?? bodyContent ?? section;
}

function dispatchTimelineInteractionEvent(
  target: HTMLElement,
  kind: string,
  iteration: number,
  deltaMagnitude: number,
) {
  const rect = target.getBoundingClientRect();
  const direction = Math.floor(iteration / 8) % 2 === 0 ? 1 : -1;
  const clientX = rect.left + Math.max(4, Math.min(rect.width - 4, rect.width * (0.2 + (iteration % 7) * 0.1)));
  const clientY = rect.top + Math.max(4, Math.min(rect.height - 4, rect.height * 0.5));

  if (kind === 'pointer-move') {
    const pointerEvent = new PointerEvent('pointermove', {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      pointerId: 997,
      pointerType: 'mouse',
      isPrimary: true,
    });
    target.dispatchEvent(pointerEvent);
    return;
  }

  const horizontal = kind === 'horizontal-wheel' || kind === 'horizontal-trackpad';
  const wheelEvent = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    deltaMode: WheelEvent.DOM_DELTA_PIXEL,
    deltaX: kind === 'horizontal-trackpad' ? direction * deltaMagnitude : 0,
    deltaY: kind === 'horizontal-wheel' || kind === 'vertical-wheel' ? direction * deltaMagnitude : 0,
    shiftKey: kind === 'horizontal-wheel',
  });
  target.dispatchEvent(wheelEvent);
  if (horizontal && !wheelEvent.defaultPrevented && kind === 'horizontal-trackpad') {
    target.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      deltaX: direction * deltaMagnitude,
      deltaY: 0,
    }));
  }
}

function waitForAnimationFrames(count = 2) {
  return new Promise<void>((resolve) => {
    const step = () => {
      if (count-- <= 1) {
        resolve();
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function getPlayheadEdgeDragSnapshot() {
  const state = useTimelineStore.getState();
  return {
    isDraggingPlayhead: state.isDraggingPlayhead,
    isPlaying: state.isPlaying,
    playheadPosition: state.playheadPosition,
    scrollX: state.scrollX,
    zoom: state.zoom,
  };
}

async function measurePlayheadEdgeDrag(args: Record<string, unknown>) {
  const originalState = useTimelineStore.getState();
  const original = {
    isDraggingPlayhead: originalState.isDraggingPlayhead,
    isPlaying: originalState.isPlaying,
    playheadPosition: originalState.playheadPosition,
    scrollX: originalState.scrollX,
    zoom: originalState.zoom,
  };
  const holdMs = typeof args.holdMs === 'number' && Number.isFinite(args.holdMs)
    ? Math.max(250, Math.min(2000, Math.round(args.holdMs)))
    : 600;

  if (original.isDraggingPlayhead) {
    return {
      success: false,
      error: 'Finish the active playhead drag before running this probe.',
      data: { kind: 'playhead-edge-drag', original },
    };
  }

  const laneReference = document.querySelector<HTMLElement>('.timeline-lane-reference');
  if (!laneReference || originalState.duration <= 0) {
    return {
      success: false,
      error: 'A visible timeline with a positive duration is required.',
      data: { kind: 'playhead-edge-drag', original },
    };
  }

  let released: (ReturnType<typeof getPlayheadEdgeDragSnapshot> & {
    restored?: ReturnType<typeof getPlayheadEdgeDragSnapshot>;
  }) | null = null;
  let restored: ReturnType<typeof getPlayheadEdgeDragSnapshot> | null = null;
  try {
    originalState.pause();
    const initialRect = laneReference.getBoundingClientRect();
    const requiredZoom = (initialRect.width + 580) / originalState.duration;
    originalState.setZoom(Math.max(original.zoom, requiredZoom));
    await waitForAnimationFrames();

    const rect = laneReference.getBoundingClientRect();
    const state = useTimelineStore.getState();
    const maxScrollX = Math.max(0, state.duration * state.zoom - rect.width + 100);
    if (rect.width <= 0 || maxScrollX < 160) {
      return {
        success: false,
        error: 'Timeline cannot scroll far enough for the bounded edge-drag probe.',
        data: { kind: 'playhead-edge-drag', original, maxScrollX },
      };
    }

    const stagedScrollX = maxScrollX / 2;
    state.setScrollX(stagedScrollX);
    state.setPlayheadPosition(Math.max(0, Math.min(
      state.duration,
      (stagedScrollX + rect.width / 2) / state.zoom,
    )));
    await waitForAnimationFrames();

    const playhead = document.querySelector<HTMLElement>('[data-ai-id="timeline-playhead"]');
    if (!playhead) {
      return {
        success: false,
        error: 'Timeline playhead target not found after probe setup.',
        data: { kind: 'playhead-edge-drag', original },
      };
    }

    const playheadRect = playhead.getBoundingClientRect();
    playhead.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      clientX: playheadRect.left + Math.max(1, playheadRect.width / 2),
      clientY: playheadRect.top + Math.max(1, playheadRect.height / 2),
      view: window,
    }));
    await waitForAnimationFrames();

    const dispatchMove = (clientX: number) => {
      document.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 1,
        clientX,
        clientY: rect.top + Math.max(1, rect.height / 2),
        view: window,
      }));
    };
    const waitForHold = () => new Promise<void>(resolve => window.setTimeout(resolve, holdMs));

    dispatchMove(rect.right - 4);
    const rightAfterMove = getPlayheadEdgeDragSnapshot();
    await waitForHold();
    const rightAfterHold = getPlayheadEdgeDragSnapshot();

    dispatchMove(rect.left + 4);
    const leftAfterMove = getPlayheadEdgeDragSnapshot();
    await waitForHold();
    const leftAfterHold = getPlayheadEdgeDragSnapshot();

    document.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 0,
      clientX: rect.left + 4,
      clientY: rect.top + Math.max(1, rect.height / 2),
      view: window,
    }));
    await waitForAnimationFrames();
    released = getPlayheadEdgeDragSnapshot();

    return {
      success: true,
      data: {
        kind: 'playhead-edge-drag',
        holdMs,
        original,
        right: {
          afterMove: rightAfterMove,
          afterHold: rightAfterHold,
          scrollDelta: rightAfterHold.scrollX - rightAfterMove.scrollX,
          playheadDelta: rightAfterHold.playheadPosition - rightAfterMove.playheadPosition,
        },
        left: {
          afterMove: leftAfterMove,
          afterHold: leftAfterHold,
          scrollDelta: leftAfterHold.scrollX - leftAfterMove.scrollX,
          playheadDelta: leftAfterHold.playheadPosition - leftAfterMove.playheadPosition,
        },
        released,
      },
    };
  } finally {
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, buttons: 0, view: window }));
    const state = useTimelineStore.getState();
    state.pause();
    state.setZoom(original.zoom);
    state.setScrollX(original.scrollX);
    state.setPlayheadPosition(original.playheadPosition);
    if (original.isPlaying) await state.play();
    await waitForAnimationFrames();
    restored = getPlayheadEdgeDragSnapshot();
    if (released) {
      released.restored = restored;
    }
  }
}

export async function measureTimelineInteraction(args: Record<string, unknown> = {}) {
  const durationMs = typeof args.durationMs === 'number' && Number.isFinite(args.durationMs)
    ? Math.max(500, Math.min(60000, Math.round(args.durationMs)))
    : 5000;
  const eventIntervalMs = typeof args.eventIntervalMs === 'number' && Number.isFinite(args.eventIntervalMs)
    ? Math.max(16, Math.min(500, Math.round(args.eventIntervalMs)))
    : 50;
  const deltaMagnitude = typeof args.delta === 'number' && Number.isFinite(args.delta)
    ? Math.max(1, Math.min(2000, Math.round(Math.abs(args.delta))))
    : 140;
  const kind = typeof args.kind === 'string' && args.kind.trim()
    ? args.kind.trim()
    : 'horizontal-wheel';
  if (kind === 'playhead-edge-drag') {
    return measurePlayheadEdgeDrag(args);
  }
  const sectionKind = args.sectionKind === 'video' ? 'video' : 'audio';
  const target = getTimelineInteractionTarget(kind, sectionKind);
  if (!target) {
    return {
      success: false,
      error: 'Timeline interaction target not found.',
      data: {
        kind,
        sectionKind,
        snapshot: collectTimelineInteractionSnapshot(),
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
  const beforeSnapshot = collectTimelineInteractionSnapshot();
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
          longAnimationFrames.push({
            name: entry.name,
            startTime: Math.round(entry.startTime * 100) / 100,
            durationMs: Math.round(entry.duration * 100) / 100,
            entryType: entry.entryType,
          });
        }
      });
      animationFrameObserver.observe({ entryTypes: ['long-animation-frame'] });
    } catch {
      animationFrameObserver = null;
    }
  }

  try {
    timerId = window.setInterval(() => {
      dispatchTimelineInteractionEvent(target, kind, eventCount, deltaMagnitude);
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
    if (frameId !== null) window.cancelAnimationFrame(frameId);
    observer?.disconnect();
    animationFrameObserver?.disconnect();
  }

  const deltas = frames.map(frame => frame.deltaMs);
  const droppedFrameEstimate = deltas.reduce((sum, delta) => (
    sum + Math.max(0, Math.round(delta / expectedFrameMs) - 1)
  ), 0);
  const slowFrames = frames.filter(frame => frame.deltaMs > expectedFrameMs * 1.75);
  const timelineState = useTimelineStore.getState();
  return {
    success: true,
    data: {
      kind,
      sectionKind,
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
      afterSnapshot: collectTimelineInteractionSnapshot(),
      stemClipCount: timelineState.clips.filter((clip) => clip.audioState?.stemSeparation?.stems.length).length,
      selectedClipIds: Array.from(timelineState.selectedClipIds),
      target: summarizeElementForDebug(target),
      frames: frames.slice(-240),
    },
  };
}
