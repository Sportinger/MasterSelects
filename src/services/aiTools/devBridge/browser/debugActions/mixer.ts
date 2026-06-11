import { useTimelineStore } from '../../../../../stores/timeline';
import { runtimeAudioMeterBus } from '../../../../audio/runtimeAudioMeterBus';
import { projectFileService } from '../../../../projectFileService';
import {
  summarizeLongAnimationFrameEntry,
  summarizeNumberList,
  summarizePerformanceMemory,
  summarizeProxyAudioCache,
} from './performance';
import { summarizeElementForDebug } from './interaction';

function getNativeInputValueSetter(input: HTMLInputElement): ((value: string) => void) | null {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  return typeof descriptor?.set === 'function'
    ? descriptor.set.bind(input) as (value: string) => void
    : null;
}

function readFaderNumber(fader: HTMLElement, name: 'value' | 'min' | 'max' | 'step'): number {
  if (fader instanceof HTMLInputElement) {
    return Number(fader[name]);
  }
  const attr = name === 'value'
    ? fader.getAttribute('data-value') ?? fader.getAttribute('aria-valuenow')
    : fader.getAttribute(`data-${name}`) ?? fader.getAttribute(`aria-${name}`);
  return Number(attr);
}

function readFaderValue(fader: HTMLElement): string {
  if (fader instanceof HTMLInputElement) return fader.value;
  return fader.getAttribute('data-value') ?? fader.getAttribute('aria-valuenow') ?? '';
}

function getFaderLabel(fader: HTMLElement): string | null {
  return fader.getAttribute('aria-label');
}

function collectMixerInteractionSnapshot() {
  const panel = document.querySelector<HTMLElement>('.audio-mixer-panel');
  const faders = Array.from(document.querySelectorAll<HTMLElement>('.audio-mixer-strip-fader'));
  const meters = Array.from(document.querySelectorAll<HTMLElement>('.audio-mixer-meter, .audio-level-meter'));
  return {
    panel: summarizeElementForDebug(panel),
    faderCount: faders.length,
    meterCount: meters.length,
    faders: faders.slice(0, 12).map((fader) => ({
      element: summarizeElementForDebug(fader),
      value: readFaderValue(fader),
      min: String(readFaderNumber(fader, 'min')),
      max: String(readFaderNumber(fader, 'max')),
      step: String(readFaderNumber(fader, 'step')),
      label: getFaderLabel(fader),
    })),
  };
}

function summarizeMeterElement(meter: HTMLElement, index: number) {
  const rect = meter.getBoundingClientRect();
  const style = window.getComputedStyle(meter);
  const peakFill = meter.querySelector<HTMLElement>('.audio-level-meter-peak-fill');
  const rms = meter.querySelector<HTMLElement>('.audio-level-meter-rms');
  const scale = meter.querySelector<HTMLElement>('.audio-level-meter-scale');
  const peakStyle = peakFill ? window.getComputedStyle(peakFill) : null;
  const rmsStyle = rms ? window.getComputedStyle(rms) : null;
  const scaleStyle = scale ? window.getComputedStyle(scale) : null;
  return {
    index,
    className: meter.className,
    label: meter.getAttribute('aria-label') ?? meter.getAttribute('title'),
    rect: {
      x: Math.round(rect.x * 100) / 100,
      y: Math.round(rect.y * 100) / 100,
      width: Math.round(rect.width * 100) / 100,
      height: Math.round(rect.height * 100) / 100,
    },
    visible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0',
    display: style.display,
    visibility: style.visibility,
    opacity: style.opacity,
    background: style.backgroundImage || style.backgroundColor,
    peakFill: peakFill ? {
      exists: true,
      className: peakFill.className,
      transform: peakStyle?.transform,
      opacity: peakStyle?.opacity,
      background: peakStyle?.backgroundImage || peakStyle?.backgroundColor,
      rect: (() => {
        const fillRect = peakFill.getBoundingClientRect();
        return {
          width: Math.round(fillRect.width * 100) / 100,
          height: Math.round(fillRect.height * 100) / 100,
        };
      })(),
    } : { exists: false },
    rms: rms ? {
      exists: true,
      transform: rmsStyle?.transform,
      opacity: rmsStyle?.opacity,
    } : { exists: false },
    scale: scale ? {
      exists: true,
      opacity: scaleStyle?.opacity,
      background: scaleStyle?.backgroundImage || scaleStyle?.backgroundColor,
    } : { exists: false },
  };
}

function summarizeRuntimeMeterBus() {
  const debug = runtimeAudioMeterBus.getDebugSnapshot();
  const trackEntries = Object.entries(debug.tracks);
  return {
    master: debug.master
      ? {
          peakDb: Math.round(debug.master.peakDb * 100) / 100,
          rmsDb: Math.round(debug.master.rmsDb * 100) / 100,
          peakLinear: Math.round(debug.master.peakLinear * 10000) / 10000,
          updatedAt: Math.round(debug.master.updatedAt),
        }
      : null,
    trackCount: trackEntries.length,
    audibleTrackCount: trackEntries.filter(([, snapshot]) => snapshot.peakLinear > 0 || snapshot.rmsLinear > 0).length,
    tracks: trackEntries.slice(0, 24).map(([trackId, snapshot]) => ({
      trackId,
      peakDb: Math.round(snapshot.peakDb * 100) / 100,
      rmsDb: Math.round(snapshot.rmsDb * 100) / 100,
      peakLinear: Math.round(snapshot.peakLinear * 10000) / 10000,
      updatedAt: Math.round(snapshot.updatedAt),
    })),
    demand: debug.demand,
  };
}

export function inspectMixerMeters() {
  const meters = Array.from(document.querySelectorAll<HTMLElement>('.audio-mixer-meter, .audio-level-meter'));
  return {
    success: true,
    data: {
      snapshot: collectMixerInteractionSnapshot(),
      runtimeMeterBus: summarizeRuntimeMeterBus(),
      meters: meters.slice(0, 40).map(summarizeMeterElement),
    },
  };
}

function findMixerFader(args: Record<string, unknown> = {}): HTMLElement | null {
  const label = typeof args.label === 'string' ? args.label.trim().toLowerCase() : '';
  const faders = Array.from(document.querySelectorAll<HTMLElement>('.audio-mixer-strip-fader'));
  if (label) {
    return faders.find((fader) => fader.getAttribute('aria-label')?.toLowerCase().includes(label)) ?? null;
  }
  return faders[0] ?? null;
}

type MixerFaderRecording = {
  active: boolean;
  startedAt: number;
  durationMs: number;
  frames: Array<{ elapsedMs: number; deltaMs: number }>;
  longTasks: Array<Record<string, unknown>>;
  longAnimationFrames: Array<Record<string, unknown>>;
  faderEvents: Array<{ elapsedMs: number; type: string; value: string; label: string | null }>;
  timelineEvents: Array<{ elapsedMs: number; source: string }>;
  beforeCache: ReturnType<typeof summarizeProxyAudioCache>;
  beforeMemory: ReturnType<typeof summarizePerformanceMemory>;
  beforeSnapshot: ReturnType<typeof collectMixerInteractionSnapshot>;
  observer: PerformanceObserver | null;
  animationFrameObserver: PerformanceObserver | null;
  frameId: number | null;
  timeoutId: number | null;
  previousFrameAt: number | null;
  unsubscribeTracks: (() => void) | null;
  unsubscribeMaster: (() => void) | null;
};

let mixerFaderRecording: MixerFaderRecording | null = null;

const MIXER_FADER_RECORD_EVENT_TYPES = [
  'pointerdown',
  'pointermove',
  'pointerup',
  'mousedown',
  'mousemove',
  'mouseup',
  'input',
  'change',
] as const;

function recordManualFaderEvent(recording: MixerFaderRecording, event: Event) {
  const target = event.target instanceof HTMLElement
    ? event.target.closest<HTMLElement>('.audio-mixer-strip-fader')
    : null;
  if (!target) return;
  recording.faderEvents.push({
    elapsedMs: Math.round((performance.now() - recording.startedAt) * 100) / 100,
    type: event.type,
    value: readFaderValue(target),
    label: getFaderLabel(target),
  });
  if (recording.faderEvents.length > 1000) recording.faderEvents.shift();
}

function stopMixerFaderRecording(): MixerFaderRecording | null {
  const recording = mixerFaderRecording;
  if (!recording || !recording.active) return recording;
  recording.active = false;
  for (const type of MIXER_FADER_RECORD_EVENT_TYPES) {
    document.removeEventListener(type, manualFaderRecordEventHandler, true);
  }
  if (recording.frameId !== null) window.cancelAnimationFrame(recording.frameId);
  if (recording.timeoutId !== null) window.clearTimeout(recording.timeoutId);
  recording.observer?.disconnect();
  recording.animationFrameObserver?.disconnect();
  recording.unsubscribeTracks?.();
  recording.unsubscribeMaster?.();
  recording.frameId = null;
  recording.timeoutId = null;
  recording.observer = null;
  recording.animationFrameObserver = null;
  recording.unsubscribeTracks = null;
  recording.unsubscribeMaster = null;
  return recording;
}

function summarizeMixerFaderRecording(recording: MixerFaderRecording | null) {
  if (!recording) {
    return {
      active: false,
      available: false,
    };
  }
  const expectedFrameMs = 1000 / 60;
  const deltas = recording.frames.map(frame => frame.deltaMs);
  const droppedFrameEstimate = deltas.reduce((sum, delta) => (
    sum + Math.max(0, Math.round(delta / expectedFrameMs) - 1)
  ), 0);
  const slowFrames = recording.frames.filter(frame => frame.deltaMs > expectedFrameMs * 1.75);
  return {
    active: recording.active,
    available: true,
    elapsedMs: Math.round(performance.now() - recording.startedAt),
    durationMs: recording.durationMs,
    frameCount: recording.frames.length,
    estimatedFps: Math.round((recording.frames.length / Math.max(1, (Math.min(performance.now() - recording.startedAt, recording.durationMs)) / 1000)) * 100) / 100,
    frameDeltaMs: summarizeNumberList(deltas),
    slowFrameCount: slowFrames.length,
    droppedFrameEstimate,
    longTaskCount: recording.longTasks.length,
    longAnimationFrameCount: recording.longAnimationFrames.length,
    longTasks: recording.longTasks.slice(0, 40),
    longAnimationFrames: recording.longAnimationFrames.slice(0, 40),
    faderEventCount: recording.faderEvents.length,
    faderEvents: recording.faderEvents.slice(-240),
    timelineEventCount: recording.timelineEvents.length,
    timelineEvents: recording.timelineEvents.slice(-120),
    beforeMemory: recording.beforeMemory,
    afterMemory: summarizePerformanceMemory(),
    beforeCache: recording.beforeCache,
    afterCache: summarizeProxyAudioCache(),
    beforeSnapshot: recording.beforeSnapshot,
    afterSnapshot: collectMixerInteractionSnapshot(),
    page: {
      visibilityState: document.visibilityState,
      hidden: document.hidden,
      hasFocus: document.hasFocus(),
    },
    frames: recording.frames.slice(-240),
  };
}

const manualFaderRecordEventHandler = (event: Event) => {
  const recording = mixerFaderRecording;
  if (!recording?.active) return;
  recordManualFaderEvent(recording, event);
};

export function armMixerFaderRecording(args: Record<string, unknown> = {}) {
  const durationMs = typeof args.durationMs === 'number' && Number.isFinite(args.durationMs)
    ? Math.max(1000, Math.min(120000, Math.round(args.durationMs)))
    : 30000;

  stopMixerFaderRecording();
  const startedAt = performance.now();
  const recording: MixerFaderRecording = {
    active: true,
    startedAt,
    durationMs,
    frames: [],
    longTasks: [],
    longAnimationFrames: [],
    faderEvents: [],
    timelineEvents: [],
    beforeCache: summarizeProxyAudioCache(),
    beforeMemory: summarizePerformanceMemory(),
    beforeSnapshot: collectMixerInteractionSnapshot(),
    observer: null,
    animationFrameObserver: null,
    frameId: null,
    timeoutId: null,
    previousFrameAt: null,
    unsubscribeTracks: null,
    unsubscribeMaster: null,
  };
  mixerFaderRecording = recording;

  recording.unsubscribeTracks = useTimelineStore.subscribe(
    state => state.tracks,
    () => recording.timelineEvents.push({
      elapsedMs: Math.round(performance.now() - startedAt),
      source: 'timeline.tracks',
    }),
  );
  recording.unsubscribeMaster = useTimelineStore.subscribe(
    state => state.masterAudioState,
    () => recording.timelineEvents.push({
      elapsedMs: Math.round(performance.now() - startedAt),
      source: 'timeline.masterAudioState',
    }),
  );

  if (typeof PerformanceObserver !== 'undefined') {
    try {
      recording.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          recording.longTasks.push({
            name: entry.name,
            startTime: Math.round((entry.startTime - startedAt) * 100) / 100,
            durationMs: Math.round(entry.duration * 100) / 100,
            entryType: entry.entryType,
          });
        }
      });
      recording.observer.observe({ entryTypes: ['longtask'] });
    } catch {
      recording.observer = null;
    }

    try {
      recording.animationFrameObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          recording.longAnimationFrames.push(summarizeLongAnimationFrameEntry(entry, startedAt));
        }
      });
      recording.animationFrameObserver.observe({ entryTypes: ['long-animation-frame'] });
    } catch {
      recording.animationFrameObserver = null;
    }
  }

  for (const type of MIXER_FADER_RECORD_EVENT_TYPES) {
    document.addEventListener(type, manualFaderRecordEventHandler, true);
  }

  const tick = (timestamp: number) => {
    if (!recording.active) return;
    if (recording.previousFrameAt !== null) {
      recording.frames.push({
        elapsedMs: Math.round(timestamp - startedAt),
        deltaMs: Math.round((timestamp - recording.previousFrameAt) * 100) / 100,
      });
    }
    recording.previousFrameAt = timestamp;
    if (timestamp - startedAt >= durationMs) {
      stopMixerFaderRecording();
      return;
    }
    recording.frameId = window.requestAnimationFrame(tick);
  };
  recording.frameId = window.requestAnimationFrame(tick);
  recording.timeoutId = window.setTimeout(() => {
    stopMixerFaderRecording();
  }, durationMs + 250);

  return {
    success: true,
    data: {
      armed: true,
      durationMs,
      snapshot: collectMixerInteractionSnapshot(),
      page: {
        visibilityState: document.visibilityState,
        hidden: document.hidden,
        hasFocus: document.hasFocus(),
      },
    },
  };
}

export function getMixerFaderRecording(args: Record<string, unknown> = {}) {
  if (args.stop === true) {
    stopMixerFaderRecording();
  }
  return {
    success: true,
    data: summarizeMixerFaderRecording(mixerFaderRecording),
  };
}

export function clearMixerFaderRecording() {
  stopMixerFaderRecording();
  mixerFaderRecording = null;
  return {
    success: true,
    data: {
      active: false,
      available: false,
    },
  };
}

export async function measureMixerFaderInteraction(args: Record<string, unknown> = {}) {
  const durationMs = typeof args.durationMs === 'number' && Number.isFinite(args.durationMs)
    ? Math.max(500, Math.min(60000, Math.round(args.durationMs)))
    : 3500;
  const eventIntervalMs = typeof args.eventIntervalMs === 'number' && Number.isFinite(args.eventIntervalMs)
    ? Math.max(16, Math.min(500, Math.round(args.eventIntervalMs)))
    : 16;
  const eventDriver = args.eventDriver === 'raf' ? 'raf' : 'interval';
  const fader = findMixerFader(args);
  if (!fader) {
    return {
      success: false,
      error: 'Audio mixer fader not found.',
      data: {
        snapshot: collectMixerInteractionSnapshot(),
      },
    };
  }

  const expectedFrameMs = 1000 / 60;
  const startedAt = performance.now();
  const frames: Array<{ elapsedMs: number; deltaMs: number }> = [];
  const longTasks: Array<Record<string, unknown>> = [];
  const longAnimationFrames: Array<Record<string, unknown>> = [];
  const timelineEvents: Array<{ elapsedMs: number; source: string }> = [];
  const beforeCache = summarizeProxyAudioCache();
  const beforeMemory = summarizePerformanceMemory();
  const beforeSnapshot = collectMixerInteractionSnapshot();
  const beforeValue = readFaderNumber(fader, 'value');
  const nativeOnly = args.nativeOnly === true;
  const skipStoreCommit = args.skipStoreCommit === true;
  const min = Number.isFinite(readFaderNumber(fader, 'min')) ? readFaderNumber(fader, 'min') : -60;
  const max = Number.isFinite(readFaderNumber(fader, 'max')) ? readFaderNumber(fader, 'max') : 18;
  const amplitude = Math.min(12, Math.max(1, (max - min) * 0.2));
  const center = Math.max(min + amplitude, Math.min(max - amplitude, Number.isFinite(beforeValue) ? beforeValue : 0));
  const setNativeValue = fader instanceof HTMLInputElement ? getNativeInputValueSetter(fader) : null;
  let observer: PerformanceObserver | null = null;
  let animationFrameObserver: PerformanceObserver | null = null;
  let frameId: number | null = null;
  let timerId: number | null = null;
  let previousFrameAt: number | null = null;
  let eventCount = 0;
  const timelineStateForPatch = useTimelineStore.getState();
  const originalSetTrackAudioVolumeDb = timelineStateForPatch.setTrackAudioVolumeDb;
  const originalSetMasterAudioVolumeDb = timelineStateForPatch.setMasterAudioVolumeDb;
  const faderRect = fader.getBoundingClientRect();
  const faderThumbHeight = fader.querySelector<HTMLElement>('.audio-mixer-strip-fader-thumb')?.offsetHeight ?? 34;
  const projectServiceForPatch = projectFileService as unknown as {
    markDirty: () => void;
    saveProject: () => Promise<boolean>;
  };
  const originalMarkDirty = projectServiceForPatch.markDirty.bind(projectFileService);
  const originalSaveProject = projectServiceForPatch.saveProject.bind(projectFileService);
  let markDirtyCount = 0;
  let saveProjectCount = 0;
  let saveProjectTotalMs = 0;

  const unsubscribeTracks = useTimelineStore.subscribe(
    state => state.tracks,
    () => timelineEvents.push({ elapsedMs: Math.round(performance.now() - startedAt), source: 'timeline.tracks' }),
  );
  const unsubscribeMaster = useTimelineStore.subscribe(
    state => state.masterAudioState,
    () => timelineEvents.push({ elapsedMs: Math.round(performance.now() - startedAt), source: 'timeline.masterAudioState' }),
  );

  if (typeof PerformanceObserver !== 'undefined') {
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.push({
            name: entry.name,
            startTime: Math.round((entry.startTime - startedAt) * 100) / 100,
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

  const commitFaderValue = (value: number) => {
    const next = Math.max(min, Math.min(max, value));
    if (fader instanceof HTMLInputElement) {
      if (setNativeValue) {
        setNativeValue(String(next));
      } else {
        fader.value = String(next);
      }
      if (nativeOnly) return;
      fader.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      fader.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      return;
    }
    const rect = faderRect;
    const normalized = (next - min) / Math.max(1, max - min);
    const clientY = rect.top + (1 - Math.max(0, Math.min(1, normalized))) * rect.height;
    if (nativeOnly) {
      const thumbTravelPx = Math.max(0, rect.height - faderThumbHeight);
      const thumbY = (1 - Math.max(0, Math.min(1, normalized))) * thumbTravelPx;
      fader.style.setProperty('--audio-mixer-fader-thumb-y', `${thumbY}px`);
      fader.setAttribute('data-value', String(next));
      fader.setAttribute('aria-valuenow', String(next));
      return;
    }
    fader.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      cancelable: true,
      buttons: 1,
      clientX: rect.left + rect.width / 2,
      clientY,
      pointerId: 901,
      pointerType: 'mouse',
      isPrimary: true,
    }));
  };

  try {
    projectServiceForPatch.markDirty = () => {
      markDirtyCount += 1;
      return originalMarkDirty();
    };
    projectServiceForPatch.saveProject = async () => {
      saveProjectCount += 1;
      const saveStartedAt = performance.now();
      try {
        return await originalSaveProject();
      } finally {
        saveProjectTotalMs += performance.now() - saveStartedAt;
      }
    };
    if (skipStoreCommit) {
      timelineStateForPatch.setTrackAudioVolumeDb = () => {};
      timelineStateForPatch.setMasterAudioVolumeDb = () => {};
    }
    const rect = faderRect;
    fader.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      pointerId: 901,
      pointerType: 'mouse',
      isPrimary: true,
    }));

    if (eventDriver === 'interval') {
      timerId = window.setInterval(() => {
        const progress = (eventCount % 48) / 48;
        commitFaderValue(center + Math.sin(progress * Math.PI * 2) * amplitude);
        eventCount += 1;
      }, eventIntervalMs);
    }

    await new Promise<void>((resolve) => {
      const tick = (timestamp: number) => {
        if (eventDriver === 'raf') {
          const progress = (eventCount % 96) / 96;
          commitFaderValue(center + Math.sin(progress * Math.PI * 2) * amplitude);
          eventCount += 1;
        }
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
    commitFaderValue(beforeValue);
    if (skipStoreCommit) {
      timelineStateForPatch.setTrackAudioVolumeDb = originalSetTrackAudioVolumeDb;
      timelineStateForPatch.setMasterAudioVolumeDb = originalSetMasterAudioVolumeDb;
    }
    projectServiceForPatch.markDirty = originalMarkDirty;
    projectServiceForPatch.saveProject = originalSaveProject;
    fader.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      cancelable: true,
      pointerId: 901,
      pointerType: 'mouse',
      isPrimary: true,
    }));
    if (frameId !== null) window.cancelAnimationFrame(frameId);
    observer?.disconnect();
    animationFrameObserver?.disconnect();
    unsubscribeTracks();
    unsubscribeMaster();
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
      eventDriver,
      nativeOnly,
      skipStoreCommit,
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
      timelineEventCount: timelineEvents.length,
      timelineEvents: timelineEvents.slice(-80),
      markDirtyCount,
      saveProjectCount,
      saveProjectMs: {
        total: Math.round(saveProjectTotalMs * 100) / 100,
        avg: saveProjectCount > 0
          ? Math.round((saveProjectTotalMs / saveProjectCount) * 100) / 100
          : 0,
      },
      beforeMemory,
      afterMemory: summarizePerformanceMemory(),
      beforeCache,
      afterCache: summarizeProxyAudioCache(),
      beforeSnapshot,
      afterSnapshot: collectMixerInteractionSnapshot(),
      target: summarizeElementForDebug(fader),
      frames: frames.slice(-240),
    },
  };
}

export async function recordMixerFaderInteraction(args: Record<string, unknown> = {}) {
  const durationMs = typeof args.durationMs === 'number' && Number.isFinite(args.durationMs)
    ? Math.max(1000, Math.min(120000, Math.round(args.durationMs)))
    : 30000;
  const expectedFrameMs = 1000 / 60;
  const startedAt = performance.now();
  const frames: Array<{ elapsedMs: number; deltaMs: number }> = [];
  const longTasks: Array<Record<string, unknown>> = [];
  const longAnimationFrames: Array<Record<string, unknown>> = [];
  const faderEvents: Array<{ elapsedMs: number; type: string; value: string; label: string | null }> = [];
  const beforeCache = summarizeProxyAudioCache();
  const beforeMemory = summarizePerformanceMemory();
  const beforeSnapshot = collectMixerInteractionSnapshot();
  const faders = Array.from(document.querySelectorAll<HTMLInputElement>('.audio-mixer-strip-fader'));
  let observer: PerformanceObserver | null = null;
  let animationFrameObserver: PerformanceObserver | null = null;
  let frameId: number | null = null;
  let previousFrameAt: number | null = null;

  const recordFaderEvent = (event: Event) => {
    const target = event.target instanceof HTMLInputElement ? event.target : null;
    if (!target || !target.classList.contains('audio-mixer-strip-fader')) return;
    faderEvents.push({
      elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
      type: event.type,
      value: target.value,
      label: target.getAttribute('aria-label'),
    });
    if (faderEvents.length > 500) faderEvents.shift();
  };

  if (typeof PerformanceObserver !== 'undefined') {
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.push({
            name: entry.name,
            startTime: Math.round((entry.startTime - startedAt) * 100) / 100,
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

  try {
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mousemove', 'mouseup', 'input', 'change']) {
      document.addEventListener(type, recordFaderEvent, true);
    }

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
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mousemove', 'mouseup', 'input', 'change']) {
      document.removeEventListener(type, recordFaderEvent, true);
    }
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
      frameCount: frames.length,
      estimatedFps: Math.round((frames.length / Math.max(1, durationMs / 1000)) * 100) / 100,
      frameDeltaMs: summarizeNumberList(deltas),
      slowFrameCount: slowFrames.length,
      droppedFrameEstimate,
      longTaskCount: longTasks.length,
      longAnimationFrameCount: longAnimationFrames.length,
      longTasks,
      longAnimationFrames,
      faderCount: faders.length,
      faderEventCount: faderEvents.length,
      faderEvents: faderEvents.slice(-160),
      beforeMemory,
      afterMemory: summarizePerformanceMemory(),
      beforeCache,
      afterCache: summarizeProxyAudioCache(),
      beforeSnapshot,
      afterSnapshot: collectMixerInteractionSnapshot(),
      page: {
        visibilityState: document.visibilityState,
        hidden: document.hidden,
        hasFocus: document.hasFocus(),
      },
      frames: frames.slice(-240),
    },
  };
}
