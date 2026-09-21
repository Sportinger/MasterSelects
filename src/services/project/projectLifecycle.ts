// Project Lifecycle — create, open, close, auto-sync

import { Logger } from '../logger';
import { preserveUnsavedProjectOnChunkFailure } from '../../runtime/chunkReloadGuard';
import { useMediaStore, type MediaFile, type Composition, type MediaFolder } from '../../stores/mediaStore';
import type { MediaState } from '../../stores/mediaStore/types';
import { useTimelineStore } from '../../stores/timeline';
import { useDockStore } from '../../stores/dockStore';
import { useSettingsStore } from '../../stores/settingsStore';
import {
  getFlashBoardChatMessages,
  resetFlashBoardActiveGenerationState,
  restoreFlashBoardActiveGenerationRecordsFromRecovery,
  subscribeFlashBoardActiveGenerationRecords,
  subscribeFlashBoardChatMessages,
  subscribeFlashBoardComposerState,
  subscribeFlashBoardPromptHistory,
} from '../../stores/flashboardStore/activeGenerationRecords';
import { useExportStore } from '../../stores/exportStore';
import { useMIDIStore } from '../../stores/midiStore';
import { projectFileService } from '../projectFileService';
import {
  isProjectStoreDirtyMarkSuppressed,
  syncStoresToProject,
} from './projectSave';
import { loadProjectToStores } from './projectLoad';
import { persistFlashBoardChatJournal } from './flashBoardChatProjectJournal';
import { setupTimelineSelectionReloadRecovery } from './timelineSelectionRecovery';
import {
  resetStoryboardProjectState,
  useStoryboardStore,
} from '../../stores/storyboardStore';
import { useSeedancePreproductionStore } from '../../stores/seedancePreproductionStore';
import { useTrackingStore } from '../../stores/trackingStore';
import {
  bucketRuntime,
  classifyProductAnalyticsFailure,
  productAnalytics,
  type ProductAnalyticsFailureCode,
  type ProductAnalyticsProjectFailureStage,
} from '../productAnalytics';

const log = Logger.create('ProjectSync');

let autoSyncDisposers: Array<() => void> = [];
let beforeUnloadHandler: ((event: BeforeUnloadEvent) => void) | null = null;
let hasProjectlessEdits = Boolean(import.meta.hot?.data?.hasProjectlessEdits);

function hasUnsavedWorkspace(): boolean {
  if (projectFileService.isProjectOpen()) {
    hasProjectlessEdits = false;
    return projectFileService.hasUnsavedChanges();
  }
  return hasProjectlessEdits
    || projectFileService.hasUnsavedChanges()
    || useMediaStore.getState().files.length > 0
    || useTimelineStore.getState().clips.length > 0
    || getFlashBoardChatMessages().length > 0;
}

type TimelineCanvasSmokeGlobal = typeof globalThis & {
  __TIMELINE_CANVAS_SMOKE_ACTIVE__?: boolean;
};

type MediaAutoSyncSelection = Pick<
  MediaState,
  'files' | 'compositions' | 'folders' | 'slotAssignments' | 'slotClipSettings'
>;

function shallowTupleEqual<T extends readonly unknown[]>(a: T, b: T): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((value, index) => Object.is(value, b[index]));
}

function isTimelineCanvasSmokeActive(): boolean {
  return Boolean((globalThis as TimelineCanvasSmokeGlobal).__TIMELINE_CANVAS_SMOKE_ACTIVE__);
}

function isPersistedMediaFileEqual(a: MediaFile, b: MediaFile): boolean {
  return a.id === b.id
    && a.name === b.name
    && a.type === b.type
    && a.parentId === b.parentId
    && a.createdAt === b.createdAt
    && a.filePath === b.filePath
    && a.projectPath === b.projectPath
    && a.fileHash === b.fileHash
    && a.duration === b.duration
    && a.width === b.width
    && a.height === b.height
    && a.fps === b.fps
    && a.codec === b.codec
    && a.videoCodecId === b.videoCodecId
    && a.codedWidth === b.codedWidth
    && a.codedHeight === b.codedHeight
    && a.rotation === b.rotation
    && a.pixelAspectRatio?.numerator === b.pixelAspectRatio?.numerator
    && a.pixelAspectRatio?.denominator === b.pixelAspectRatio?.denominator
    && a.videoColorSpace?.primaries === b.videoColorSpace?.primaries
    && a.videoColorSpace?.transfer === b.videoColorSpace?.transfer
    && a.videoColorSpace?.matrix === b.videoColorSpace?.matrix
    && a.videoColorSpace?.fullRange === b.videoColorSpace?.fullRange
    && a.hasHighDynamicRange === b.hasHighDynamicRange
    && a.canBeTransparent === b.canBeTransparent
    && a.audioCodec === b.audioCodec
    && a.container === b.container
    && a.bitrate === b.bitrate
    && a.fileSize === b.fileSize
    && a.hasAudio === b.hasAudio
    && a.splatCount === b.splatCount
    && a.totalSplatCount === b.totalSplatCount
    && a.splatFrameCount === b.splatFrameCount
    && a.proxyStatus === b.proxyStatus
    && a.proxyFrameCount === b.proxyFrameCount
    && a.proxyFps === b.proxyFps
    && a.sceneCutAnalysis === b.sceneCutAnalysis
    && a.hasProxyAudio === b.hasProxyAudio
    && a.audioProxyStatus === b.audioProxyStatus
    && a.audioProxyStorageKey === b.audioProxyStorageKey
    && a.labelColor === b.labelColor
    && a.vectorAnimation === b.vectorAnimation
    && a.modelSequence === b.modelSequence
    && a.gaussianSplatSequence === b.gaussianSplatSequence;
}

function arePersistedMediaFilesEqual(a: MediaFile[], b: MediaFile[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((file, index) => isPersistedMediaFileEqual(file, b[index]!));
}

function areCompositionsEqual(a: Composition[], b: Composition[]): boolean {
  return a === b;
}

function areFoldersEqual(a: MediaFolder[], b: MediaFolder[]): boolean {
  return a === b;
}

function selectMediaAutoSyncState(state: MediaState): MediaAutoSyncSelection {
  return {
    files: state.files,
    compositions: state.compositions,
    folders: state.folders,
    slotAssignments: state.slotAssignments,
    slotClipSettings: state.slotClipSettings,
  };
}

function isMediaAutoSyncSelectionEqual(a: MediaAutoSyncSelection, b: MediaAutoSyncSelection): boolean {
  return arePersistedMediaFilesEqual(a.files, b.files)
    && areCompositionsEqual(a.compositions, b.compositions)
    && areFoldersEqual(a.folders, b.folders)
    && a.slotAssignments === b.slotAssignments
    && a.slotClipSettings === b.slotClipSettings;
}

function registerAutoSyncDisposer(disposer: unknown): void {
  if (typeof disposer === 'function') {
    autoSyncDisposers.push(disposer as () => void);
  }
}

function trackProjectActionFailure(
  action: 'create' | 'open' | 'save',
  startedAt: number,
  reason: 'cancelled' | 'storage_error' | 'unknown',
  failureCode: ProductAnalyticsFailureCode,
  failureStage: ProductAnalyticsProjectFailureStage,
): void {
  productAnalytics.track('project_action_failed', {
    action,
    backend: projectFileService.activeBackend,
    failure_code: failureCode,
    failure_stage: failureStage,
    reason,
    runtime_bucket: bucketRuntime(Date.now() - startedAt),
  });
}

/**
 * Create a new project
 */
export async function createNewProject(name: string): Promise<boolean> {
  const startedAt = Date.now();
  let failureStage: ProductAnalyticsProjectFailureStage = 'create';
  try {
    // Create project folder on filesystem first
    const success = await projectFileService.createProject(name);
    if (!success) {
      trackProjectActionFailure('create', startedAt, 'cancelled', 'cancelled', 'selection');
      return false;
    }

    // Now sync current store state into the newly created project
    // This overwrites the empty initial project data with actual user edits
    failureStage = 'sync';
    await syncStoresToProject();
    failureStage = 'save';
    const saved = await projectFileService.saveProject();
    if (saved) {
      productAnalytics.track('project_created', {
        backend: projectFileService.activeBackend,
        runtime_bucket: bucketRuntime(Date.now() - startedAt),
      });
    } else {
      trackProjectActionFailure('save', startedAt, 'storage_error', 'storage_unavailable', 'save');
    }
    return saved;
  } catch (error) {
    trackProjectActionFailure(
      failureStage === 'save' ? 'save' : 'create',
      startedAt,
      failureStage === 'save' ? 'storage_error' : 'unknown',
      classifyProductAnalyticsFailure(error),
      failureStage,
    );
    throw error;
  }
}

export type BlankProjectCreationResult = 'created' | 'not-created' | 'save-failed';

/**
 * Create a named, empty project after the user has chosen its local parent folder.
 * The current editor state is only cleared after the project folder exists, so
 * cancelling the system folder picker leaves the current project untouched.
 */
export async function createBlankProject(name: string): Promise<BlankProjectCreationResult> {
  const startedAt = Date.now();
  let failureStage: ProductAnalyticsProjectFailureStage = 'create';
  try {
    const folderCreated = await projectFileService.createProject(name);
    if (!folderCreated) {
      trackProjectActionFailure('create', startedAt, 'cancelled', 'cancelled', 'selection');
      return 'not-created';
    }

    resetFlashBoardActiveGenerationState();
    resetStoryboardProjectState();
    useSeedancePreproductionStore.getState().reset();
    useExportStore.getState().reset();
    useTrackingStore.getState().reset();
    useMediaStore.getState().newProject();
    useMediaStore.getState().setProjectName(name);

    failureStage = 'sync';
    await syncStoresToProject();
    failureStage = 'save';
    const saved = await projectFileService.saveProject();
    if (saved) {
      productAnalytics.track('project_created', {
        backend: projectFileService.activeBackend,
        runtime_bucket: bucketRuntime(Date.now() - startedAt),
      });
    } else {
      trackProjectActionFailure('save', startedAt, 'storage_error', 'storage_unavailable', 'save');
    }
    return saved ? 'created' : 'save-failed';
  } catch (error) {
    trackProjectActionFailure(
      failureStage === 'save' ? 'save' : 'create',
      startedAt,
      failureStage === 'save' ? 'storage_error' : 'unknown',
      classifyProductAnalyticsFailure(error),
      failureStage,
    );
    throw error;
  }
}

/**
 * Open an existing project
 */
export async function openExistingProject(): Promise<boolean> {
  const startedAt = Date.now();
  let failureStage: ProductAnalyticsProjectFailureStage = 'selection';
  try {
    const success = await projectFileService.openProject();
    if (!success) {
      trackProjectActionFailure('open', startedAt, 'cancelled', 'cancelled', 'selection');
      return false;
    }

    // Load project data to stores
    failureStage = 'load';
    await loadProjectToStores();

    productAnalytics.track('project_opened', {
      backend: projectFileService.activeBackend,
      runtime_bucket: bucketRuntime(Date.now() - startedAt),
      source: 'picker',
    });

    return true;
  } catch (error) {
    trackProjectActionFailure(
      'open',
      startedAt,
      failureStage === 'load' ? 'storage_error' : 'unknown',
      classifyProductAnalyticsFailure(error),
      failureStage,
    );
    throw error;
  }
}

/**
 * Open a project by name from browser storage. WebKit offers no folder
 * picker, so the app lists the stored projects and opens the chosen one.
 */
export async function openStoredProject(name: string): Promise<boolean> {
  const startedAt = Date.now();
  try {
    const success = await projectFileService.openStoredProject(name);
    if (!success) {
      trackProjectActionFailure('open', startedAt, 'storage_error', 'storage_unavailable', 'load');
      return false;
    }

    await loadProjectToStores();

    productAnalytics.track('project_opened', {
      backend: projectFileService.activeBackend,
      runtime_bucket: bucketRuntime(Date.now() - startedAt),
      source: 'browser_storage',
    });

    return true;
  } catch (error) {
    trackProjectActionFailure(
      'open',
      startedAt,
      'storage_error',
      classifyProductAnalyticsFailure(error),
      'load',
    );
    throw error;
  }
}

/**
 * Close current project
 */
export function closeCurrentProject(): void {
  productAnalytics.track('project_closed', {
    backend: projectFileService.activeBackend,
  });
  projectFileService.closeProject();
  resetFlashBoardActiveGenerationState();
  resetStoryboardProjectState();
  useSeedancePreproductionStore.getState().reset();
  useExportStore.getState().reset();
  useTrackingStore.getState().reset();
  useMediaStore.getState().newProject();
  hasProjectlessEdits = false;
}

/**
 * Mark project as dirty when stores change.
 * Disk writes belong exclusively to explicit Save and the configured interval.
 */
export function setupAutoSync(): void {
  teardownAutoSync();
  registerAutoSyncDisposer(setupTimelineSelectionReloadRecovery());
  registerAutoSyncDisposer(preserveUnsavedProjectOnChunkFailure(hasUnsavedWorkspace));
  restoreFlashBoardActiveGenerationRecordsFromRecovery();

  const markProjectDirty = () => {
    if (isProjectStoreDirtyMarkSuppressed()) {
      return;
    }
    if (isTimelineCanvasSmokeActive()) {
      log.debug('Project dirty mark skipped during timeline canvas smoke');
      return;
    }
    if (!projectFileService.isProjectOpen()) {
      // Keep unsaved store edits safe even before a project file exists.
      // Repeated setup and HMR must not forget this navigation veto.
      hasProjectlessEdits = true;
      return;
    }
    hasProjectlessEdits = false;
    projectFileService.markDirty();
  };

  // Subscribe to store changes and mark project dirty
  registerAutoSyncDisposer(useMediaStore.subscribe(
    selectMediaAutoSyncState,
    () => markProjectDirty(),
    { equalityFn: isMediaAutoSyncSelectionEqual },
  ));

  registerAutoSyncDisposer(useTimelineStore.subscribe(
    (state) => [
      state.clips,
      state.tracks,
      state.markers,
      state.inPoint,
      state.outPoint,
      state.loopPlayback,
      state.durationLocked,
    ] as const,
    () => {
      markProjectDirty();
    },
    { equalityFn: shallowTupleEqual },
  ));

  registerAutoSyncDisposer(useTrackingStore.subscribe(
    (state) => state.assets,
    () => markProjectDirty(),
  ));

  registerAutoSyncDisposer(useTimelineStore.subscribe(
    (state) => state.clipKeyframes,
    () => {
      markProjectDirty();
    }
  ));

  const handleMIDIProjectStateChange = () => {
    markProjectDirty();
  };

  registerAutoSyncDisposer(useMIDIStore.subscribe((state) => state.isEnabled, handleMIDIProjectStateChange));
  registerAutoSyncDisposer(useMIDIStore.subscribe((state) => state.transportBindings, handleMIDIProjectStateChange));
  registerAutoSyncDisposer(useMIDIStore.subscribe((state) => state.slotBindings, handleMIDIProjectStateChange));
  registerAutoSyncDisposer(useMIDIStore.subscribe((state) => state.parameterBindings, handleMIDIProjectStateChange));

  registerAutoSyncDisposer(subscribeFlashBoardActiveGenerationRecords(() => {
    markProjectDirty();
  }));
  registerAutoSyncDisposer(subscribeFlashBoardComposerState(() => {
    markProjectDirty();
  }));
  registerAutoSyncDisposer(subscribeFlashBoardPromptHistory(() => {
    markProjectDirty();
  }));
  registerAutoSyncDisposer(subscribeFlashBoardChatMessages(() => {
    markProjectDirty();
    void persistFlashBoardChatJournal(getFlashBoardChatMessages());
  }));
  registerAutoSyncDisposer(useStoryboardStore.subscribe((state, previous) => {
    if (
      state.plans !== previous.plans
      || state.scenes !== previous.scenes
      || state.generationBriefs !== previous.generationBriefs
      || state.candidates !== previous.candidates
      || state.evidenceRefs !== previous.evidenceRefs
      || state.coverageBySceneId !== previous.coverageBySceneId
      || state.variantSets !== previous.variantSets
      || state.variantOptions !== previous.variantOptions
      || state.decisions !== previous.decisions
      || state.templates !== previous.templates
    ) {
      markProjectDirty();
    }
  }));
  registerAutoSyncDisposer(useSeedancePreproductionStore.subscribe((state, previous) => {
    if (
      state.activeRunId !== previous.activeRunId
      || state.documents !== previous.documents
      || state.runs !== previous.runs
      || state.sourceBundle !== previous.sourceBundle
    ) {
      markProjectDirty();
    }
  }));

  registerAutoSyncDisposer(useExportStore.subscribe(
    (state) => [state.settings, state.presets, state.selectedPresetId, state.batch] as const,
    () => {
      markProjectDirty();
    },
    { equalityFn: shallowTupleEqual },
  ));

  // Subscribe to dock layout changes
  let prevDockLayout = useDockStore.getState().layout;
  registerAutoSyncDisposer(useDockStore.subscribe((state) => {
    if (state.layout !== prevDockLayout) {
      prevDockLayout = state.layout;
      markProjectDirty();
    }
  }));

  // Local development reloads frequently through HMR. Do not block those reloads
  // with a browser dialog; production retains its unsaved-work protection.
  beforeUnloadHandler = event => {
    if (import.meta.env.DEV) return;
    if (hasUnsavedWorkspace()) {
      event.preventDefault();
      event.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', beforeUnloadHandler);

  log.info(`Auto-sync setup complete (saveMode: ${useSettingsStore.getState().saveMode})`);
}

export function teardownAutoSync(): void {

  for (const dispose of autoSyncDisposers) {
    dispose();
  }
  autoSyncDisposers = [];

  if (beforeUnloadHandler) {
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    beforeUnloadHandler = null;
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose((data) => {
    data.hasProjectlessEdits = hasProjectlessEdits;
    teardownAutoSync();
  });
}
