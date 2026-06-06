import type {
  HistoryTimelineEditState,
  HistoryTimelineRuntimeRef,
} from './historyTimelineEditState';

export type TimelineStateBoundaryKind =
  | 'project-persistence'
  | 'canvas-render-model'
  | 'history-edit-state';

export interface TimelineStateBoundaryContract {
  kind: TimelineStateBoundaryKind;
  typeName: string;
  ownedBy: string;
  derivedFrom: readonly string[];
  mustExclude: readonly string[];
}

export const TIMELINE_STATE_BOUNDARY_CONTRACTS = {
  projectPersistence: {
    kind: 'project-persistence',
    typeName: 'CompositionTimelineData',
    ownedBy: 'Project persistence',
    derivedFrom: ['timeline store', 'media store metadata'],
    mustExclude: [
      'hover state',
      'selection state',
      'canvas geometry',
      'object URLs',
      'DOM nodes',
      'HTML media elements',
      'ImageBitmap payloads',
      'GPU resources',
      'decoder instances',
    ],
  },
  canvasRenderModel: {
    kind: 'canvas-render-model',
    typeName: 'TimelineRenderModel',
    ownedBy: 'Timeline canvas renderer',
    derivedFrom: [
      'CompositionTimelineData',
      'media store metadata',
      'cache registry state',
      'transient UI state',
    ],
    mustExclude: [
      'project save schema ownership',
      'undo stack ownership',
      'File objects',
      'DOM nodes',
      'store action callbacks',
      'cache warming callbacks',
      'decoder instances',
    ],
  },
  historyEditState: {
    kind: 'history-edit-state',
    typeName: 'HistoryTimelineEditState',
    ownedBy: 'Timeline history',
    derivedFrom: [
      'timeline edit state',
      'track state',
      'serializable clip edit state',
      'runtime refs',
    ],
    mustExclude: [
      'TimelineClip.source runtime objects',
      'File objects',
      'object URLs',
      'HTML media elements',
      'ImageBitmap payloads',
      'GPU resources',
      'decoder instances',
      'render-only geometry',
    ],
  },
} as const satisfies Record<string, TimelineStateBoundaryContract>;

export type HistoryRuntimeRehydrationReason =
  | 'undo'
  | 'redo'
  | 'restore-entry'
  | 'restore-branch'
  | 'project-load';

export type HistoryRuntimeRehydrationPolicy =
  | 'defer'
  | 'interactive'
  | 'background'
  | 'export';

export interface HistoryRuntimeRehydrationScope {
  playheadPosition?: number;
  visibleTimeRange?: {
    startTime: number;
    endTime: number;
  };
  activeTrackIds?: string[];
  selectedClipIds?: string[];
}

export interface HistoryRuntimeRehydrationRequest {
  state: HistoryTimelineEditState;
  reason: HistoryRuntimeRehydrationReason;
  policy: HistoryRuntimeRehydrationPolicy;
  scope?: HistoryRuntimeRehydrationScope;
}

export interface HistoryRuntimeRehydrationDiagnostics {
  resourceCount: number;
  deferredCount: number;
  failedCount: number;
  notes?: string[];
}

export interface HistoryRuntimeRehydrationResult {
  status: 'ready' | 'deferred' | 'partial' | 'failed';
  hydratedClipIds: string[];
  deferredClipIds: string[];
  failedClipIds?: string[];
  runtimeRefs: HistoryTimelineRuntimeRef[];
  diagnostics: HistoryRuntimeRehydrationDiagnostics;
}

export interface HistoryRuntimeRehydrationAdapter {
  rehydrateTimelineEditState(
    request: HistoryRuntimeRehydrationRequest,
  ): Promise<HistoryRuntimeRehydrationResult>;
  releaseHistoryRuntimeResources?(scope: {
    stateId: string;
    clipIds?: string[];
    reason: HistoryRuntimeRehydrationReason;
  }): Promise<void> | void;
}
