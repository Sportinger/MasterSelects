import { flags } from '../../engine/featureFlags';
import { MainFallbackRenderHostPort } from './mainFallbackRenderHostPort';
import { prefersSoftwareTimelineCanvas } from '../../utils/canvasPlatform';
import {
  selectRenderHost,
  type RenderHostSelection,
  type RenderHostSelectionTelemetry,
} from './renderHostSelection';
import type {
  ConfigureRenderHostSelectionOptions,
  RenderHostPort,
  RenderHostTelemetry,
} from './renderHostTypes';
import { isBrowserWorkerRenderHostRuntimeSupported } from './workerRenderHostRuntimeBridge';
import {
  createWorkerPresentingRenderHostPort,
  isWorkerPresentingCanvasSupported,
  type WorkerPresentingPresentationStrategy,
} from './workerPresentingRenderHostPort';
import { createWorkerShadowRenderHostPort } from './workerShadowRenderHostPort';

export type {
  ConfigureRenderHostSelectionOptions,
  RenderCaptureCanvas,
  RenderFrameCallback,
  RenderHostLayerCollector,
  RenderHostPort,
  RenderHostRenderLoop,
  RenderHostTelemetry,
  RendererMode,
} from './renderHostTypes';

export type RenderHostDevMode = 'main' | 'worker-shadow' | 'worker-presenting' | 'worker-only' | 'worker-gpu-only';

const RENDER_HOST_DEV_MODE_STORAGE_KEY = 'masterselects.renderHostMode';

const INITIAL_RENDER_HOST_SELECTION_TELEMETRY: RenderHostSelectionTelemetry = {
  selectedId: 'main-fallback',
  selectedRole: 'fallback',
  workerPrimaryRequested: false,
  workerPrimaryRegistered: false,
  workerPrimaryAvailable: false,
  blockers: ['render host selector not initialized'],
  reason: 'using main fallback: render host selector not initialized',
};

interface RenderHostRuntimeState {
  selectionTelemetry: RenderHostSelectionTelemetry;
  mainFallbackRenderHostPort: RenderHostPort;
  workerShadowRenderHostPort: RenderHostPort;
  workerPresentingRenderHostPort: RenderHostPort;
  workerOnlyRenderHostPort: RenderHostPort;
  workerPrimaryStrictWorkerOnly: boolean;
  workerPrimaryPresentationStrategy: WorkerPresentingPresentationStrategy;
  instance: RenderHostPort | null;
}

function createRenderHostRuntimeState(): RenderHostRuntimeState {
  const state = {
    selectionTelemetry: INITIAL_RENDER_HOST_SELECTION_TELEMETRY,
    instance: null,
  } as Partial<RenderHostRuntimeState> as RenderHostRuntimeState;

  state.mainFallbackRenderHostPort = new MainFallbackRenderHostPort(
    () => state.selectionTelemetry
  );
  state.workerShadowRenderHostPort = createWorkerShadowRenderHostPort({
    fallback: state.mainFallbackRenderHostPort,
    getSelectionTelemetry: () => state.selectionTelemetry,
  });
  state.workerPresentingRenderHostPort = createWorkerPresentingRenderHostPort({
    fallback: state.mainFallbackRenderHostPort,
    getSelectionTelemetry: () => state.selectionTelemetry,
    strictWorkerOnly: () => state.workerPrimaryStrictWorkerOnly,
    presentationStrategy: () => state.workerPrimaryPresentationStrategy,
  });
  state.workerOnlyRenderHostPort = state.workerPresentingRenderHostPort;
  state.workerPrimaryStrictWorkerOnly = false;
  state.workerPrimaryPresentationStrategy = 'worker-cpu-present';

  return state;
}

const hotData = import.meta.hot?.data as
  | { renderHostRuntimeState?: RenderHostRuntimeState; activeRenderHostPort?: RenderHostPort }
  | undefined;
const runtimeState = hotData?.renderHostRuntimeState ?? createRenderHostRuntimeState();
runtimeState.workerPrimaryStrictWorkerOnly = runtimeState.workerPrimaryStrictWorkerOnly === true;
runtimeState.workerPrimaryPresentationStrategy ??= 'worker-cpu-present';
runtimeState.workerOnlyRenderHostPort = runtimeState.workerPresentingRenderHostPort;

function applyRenderHostSelection(selection: RenderHostSelection<RenderHostPort>): RenderHostPort {
  runtimeState.selectionTelemetry = selection.telemetry;
  runtimeState.instance = selection.host;
  return selection.host;
}

function readRenderHostDevMode(): RenderHostDevMode | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const value = localStorage.getItem(RENDER_HOST_DEV_MODE_STORAGE_KEY);
    if (
      value === 'main' ||
      value === 'worker-shadow' ||
      value === 'worker-presenting' ||
      value === 'worker-only' ||
      value === 'worker-gpu-only'
    ) {
      return value;
    }
  } catch {
    // Ignore unavailable storage in restricted browser contexts.
  }
  return null;
}

export function getRenderHostDevMode(): RenderHostDevMode | null {
  return readRenderHostDevMode();
}

function writeRenderHostDevMode(mode: RenderHostDevMode | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (mode) {
      localStorage.setItem(RENDER_HOST_DEV_MODE_STORAGE_KEY, mode);
    } else {
      localStorage.removeItem(RENDER_HOST_DEV_MODE_STORAGE_KEY);
    }
  } catch {
    // Ignore unavailable storage in restricted browser contexts.
  }
}

function primaryForDevMode(mode: RenderHostDevMode | null): RenderHostPort {
  return mode === 'worker-shadow'
    ? runtimeState.workerShadowRenderHostPort
    : mode === 'worker-only' || mode === 'worker-gpu-only'
      ? runtimeState.workerOnlyRenderHostPort
    : runtimeState.workerPresentingRenderHostPort;
}

function workerRuntimeAvailable(): boolean {
  return flags.workerFirstRenderHost && isWorkerPresentingCanvasSupported();
}

function workerRuntimeBlockers(): readonly string[] {
  if (!flags.workerFirstRenderHost) {
    return [];
  }
  if (!isBrowserWorkerRenderHostRuntimeSupported()) {
    return ['browser Worker unavailable for worker render host runtime'];
  }
  if (typeof HTMLCanvasElement === 'undefined') {
    return ['HTMLCanvasElement unavailable for worker render host presentation'];
  }
  if (typeof HTMLCanvasElement.prototype.transferControlToOffscreen !== 'function') {
    return ['OffscreenCanvas transfer unavailable for worker render host presentation'];
  }
  if (prefersSoftwareTimelineCanvas()) {
    return ['software canvas preferred by platform policy; keeping main fallback presentation'];
  }
  return [];
}

const initialDevMode = readRenderHostDevMode();
runtimeState.workerPrimaryStrictWorkerOnly = initialDevMode === 'worker-only' || initialDevMode === 'worker-gpu-only';
runtimeState.workerPrimaryPresentationStrategy = initialDevMode === 'worker-gpu-only'
  ? 'worker-webgpu-present'
  : 'worker-cpu-present';
if (
  initialDevMode === 'worker-shadow' ||
  initialDevMode === 'worker-presenting' ||
  initialDevMode === 'worker-only' ||
  initialDevMode === 'worker-gpu-only'
) {
  flags.workerFirstRenderHost = true;
}
if (initialDevMode === 'main') {
  flags.workerFirstRenderHost = false;
}

function workerPrimaryAvailableForMode(mode: RenderHostDevMode | null): boolean {
  if (mode === 'worker-shadow') {
    return isBrowserWorkerRenderHostRuntimeSupported();
  }
  return workerRuntimeAvailable();
}

function workerPrimaryBlockersForMode(mode: RenderHostDevMode | null): readonly string[] {
  if (mode === 'worker-shadow') {
    return isBrowserWorkerRenderHostRuntimeSupported()
      ? []
      : ['browser Worker unavailable for worker render host runtime'];
  }
  const blockers = [...workerRuntimeBlockers()];
  if (mode === 'worker-gpu-only' && (typeof navigator === 'undefined' || !navigator.gpu)) {
    blockers.push('WebGPU unavailable in current browser');
  }
  return blockers;
}

let instance: RenderHostPort = runtimeState.instance
  ?? hotData?.activeRenderHostPort
  ?? applyRenderHostSelection(selectRenderHost<RenderHostPort>({
    mainFallback: runtimeState.mainFallbackRenderHostPort,
    workerPrimary: primaryForDevMode(initialDevMode),
    preferWorkerPrimary: flags.workerFirstRenderHost,
    workerPrimaryAvailable: workerPrimaryAvailableForMode(initialDevMode),
    workerPrimaryBlockers: workerPrimaryBlockersForMode(initialDevMode),
  }));
if (!hotData?.renderHostRuntimeState && hotData?.activeRenderHostPort) {
  runtimeState.selectionTelemetry = hotData.activeRenderHostPort.getTelemetry().selection;
}
runtimeState.instance = instance;

export function configureRenderHostSelection(options: ConfigureRenderHostSelectionOptions = {}): void {
  instance = applyRenderHostSelection(selectRenderHost<RenderHostPort>({
    mainFallback: runtimeState.mainFallbackRenderHostPort,
    workerPrimary: options.workerPrimary ?? runtimeState.workerPresentingRenderHostPort,
    preferWorkerPrimary: options.preferWorkerPrimary ?? flags.workerFirstRenderHost,
    workerPrimaryAvailable: options.workerPrimaryAvailable ?? workerRuntimeAvailable(),
    workerPrimaryBlockers: options.workerPrimaryBlockers ?? workerRuntimeBlockers(),
  }));
}

export function getRenderHostSelectionTelemetry(): RenderHostSelectionTelemetry {
  return runtimeState.selectionTelemetry;
}

const renderHostPortProxy = new Proxy({} as RenderHostPort, {
  get(_target, propertyKey: keyof RenderHostPort) {
    if (propertyKey === 'getTelemetry') {
      return () => ({
        ...instance.getTelemetry(),
        selection: runtimeState.selectionTelemetry,
      });
    }
    const value = instance[propertyKey];
    return typeof value === 'function'
      ? value.bind(instance)
      : value;
  },
});

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose((data) => {
    runtimeState.instance = instance;
    data.renderHostRuntimeState = runtimeState;
    data.activeRenderHostPort = instance;
  });
}

export const renderHostPort = renderHostPortProxy;

export interface RenderHostDevControls {
  getTelemetry(): RenderHostTelemetry;
  getMode(): RenderHostDevMode | null;
  setMode(mode: RenderHostDevMode | null): RenderHostTelemetry;
  enableWorkerShadow(): RenderHostTelemetry;
  enableWorkerPresenting(): RenderHostTelemetry;
  enableWorkerOnly(): RenderHostTelemetry;
  enableWorkerGpuOnly(): RenderHostTelemetry;
  disableWorkerShadow(): RenderHostTelemetry;
  disableWorkerPrimary(): RenderHostTelemetry;
}

function setWorkerShadowForDev(enabled: boolean): RenderHostTelemetry {
  writeRenderHostDevMode(enabled ? 'worker-shadow' : null);
  flags.workerFirstRenderHost = enabled;
  runtimeState.workerPrimaryStrictWorkerOnly = false;
  runtimeState.workerPrimaryPresentationStrategy = 'worker-cpu-present';
  configureRenderHostSelection({
    workerPrimary: enabled ? runtimeState.workerShadowRenderHostPort : runtimeState.workerPresentingRenderHostPort,
    preferWorkerPrimary: enabled,
    workerPrimaryAvailable: enabled ? isBrowserWorkerRenderHostRuntimeSupported() : false,
    workerPrimaryBlockers: enabled && !isBrowserWorkerRenderHostRuntimeSupported()
      ? ['browser Worker unavailable for worker render host runtime']
      : [],
  });
  return renderHostPort.getTelemetry();
}

function setWorkerPresentingForDev(enabled: boolean): RenderHostTelemetry {
  writeRenderHostDevMode(enabled ? 'worker-presenting' : null);
  flags.workerFirstRenderHost = enabled;
  runtimeState.workerPrimaryStrictWorkerOnly = false;
  runtimeState.workerPrimaryPresentationStrategy = 'worker-cpu-present';
  configureRenderHostSelection({
    workerPrimary: runtimeState.workerPresentingRenderHostPort,
    preferWorkerPrimary: enabled,
    workerPrimaryAvailable: enabled ? workerRuntimeAvailable() : false,
    workerPrimaryBlockers: enabled ? workerRuntimeBlockers() : [],
  });
  return renderHostPort.getTelemetry();
}

function setWorkerOnlyForDev(enabled: boolean): RenderHostTelemetry {
  writeRenderHostDevMode(enabled ? 'worker-only' : null);
  flags.workerFirstRenderHost = enabled;
  runtimeState.workerPrimaryStrictWorkerOnly = enabled;
  runtimeState.workerPrimaryPresentationStrategy = 'worker-cpu-present';
  configureRenderHostSelection({
    workerPrimary: runtimeState.workerOnlyRenderHostPort,
    preferWorkerPrimary: enabled,
    workerPrimaryAvailable: enabled ? workerRuntimeAvailable() : false,
    workerPrimaryBlockers: enabled ? workerRuntimeBlockers() : [],
  });
  return renderHostPort.getTelemetry();
}

function setWorkerGpuOnlyForDev(enabled: boolean): RenderHostTelemetry {
  writeRenderHostDevMode(enabled ? 'worker-gpu-only' : null);
  flags.workerFirstRenderHost = enabled;
  runtimeState.workerPrimaryStrictWorkerOnly = enabled;
  runtimeState.workerPrimaryPresentationStrategy = enabled ? 'worker-webgpu-present' : 'worker-cpu-present';
  configureRenderHostSelection({
    workerPrimary: runtimeState.workerOnlyRenderHostPort,
    preferWorkerPrimary: enabled,
    workerPrimaryAvailable: enabled ? workerRuntimeAvailable() : false,
    workerPrimaryBlockers: enabled ? workerPrimaryBlockersForMode('worker-gpu-only') : [],
  });
  return renderHostPort.getTelemetry();
}

export function setRenderHostDevMode(mode: RenderHostDevMode | null): RenderHostTelemetry {
  if (mode === 'worker-shadow') {
    return setWorkerShadowForDev(true);
  }
  if (mode === 'worker-presenting') {
    return setWorkerPresentingForDev(true);
  }
  if (mode === 'worker-only') {
    return setWorkerOnlyForDev(true);
  }
  if (mode === 'worker-gpu-only') {
    return setWorkerGpuOnlyForDev(true);
  }
  if (mode === 'main') {
    writeRenderHostDevMode('main');
    flags.workerFirstRenderHost = false;
    runtimeState.workerPrimaryStrictWorkerOnly = false;
    runtimeState.workerPrimaryPresentationStrategy = 'worker-cpu-present';
    configureRenderHostSelection({
      workerPrimary: runtimeState.workerPresentingRenderHostPort,
      preferWorkerPrimary: false,
      workerPrimaryAvailable: false,
      workerPrimaryBlockers: [],
    });
    return renderHostPort.getTelemetry();
  }

  writeRenderHostDevMode(null);
  flags.workerFirstRenderHost = false;
  runtimeState.workerPrimaryStrictWorkerOnly = false;
  runtimeState.workerPrimaryPresentationStrategy = 'worker-cpu-present';
  configureRenderHostSelection({
    workerPrimary: runtimeState.workerPresentingRenderHostPort,
    preferWorkerPrimary: false,
    workerPrimaryAvailable: false,
    workerPrimaryBlockers: [],
  });
  return renderHostPort.getTelemetry();
}

if (typeof window !== 'undefined') {
  (window as Window & { __MS_RENDER_HOST__?: RenderHostDevControls }).__MS_RENDER_HOST__ = {
    getTelemetry: () => renderHostPort.getTelemetry(),
    getMode: () => readRenderHostDevMode(),
    setMode: (mode: RenderHostDevMode | null) => setRenderHostDevMode(mode),
    enableWorkerShadow: () => setWorkerShadowForDev(true),
    enableWorkerPresenting: () => setWorkerPresentingForDev(true),
    enableWorkerOnly: () => setWorkerOnlyForDev(true),
    enableWorkerGpuOnly: () => setWorkerGpuOnlyForDev(true),
    disableWorkerShadow: () => setWorkerShadowForDev(false),
    disableWorkerPrimary: () => setWorkerPresentingForDev(false),
  };
}
