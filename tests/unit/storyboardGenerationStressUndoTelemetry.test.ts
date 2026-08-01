import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { CatalogEntry } from '../../src/services/flashboard/types';
import { flashBoardMediaBridge } from '../../src/services/flashboard/FlashBoardMediaBridge';
import type {
  StoryboardGenerationBrief,
  StoryboardProjectState,
} from '../../src/services/storyboard/contracts';
import {
  approvePreparedStoryboardGeneration,
  cancelStoryboardGeneration,
  executeStoryboardGenerationRestoreActions,
  prepareStoryboardGeneration,
  submitPreparedStoryboardGeneration,
  type StoryboardGenerationRestoreAction,
} from '../../src/services/storyboard/generation';
import {
  readStoryboardTelemetryJournal,
  resetStoryboardTelemetryForTests,
} from '../../src/services/storyboard/telemetry';
import {
  getHistoryStateView,
  initHistoryStoreRefs,
  setHistoryCallbacks,
  setHistoryDisabledForDebug,
  useHistoryStore,
} from '../../src/stores/historyStore';
import type {
  FlashBoardActiveGenerationRecord,
  FlashBoardGenerationRequest,
} from '../../src/stores/flashboardStore/types';
import { createDefaultFlashBoardComposer } from '../../src/stores/flashboardStore/defaults';
import { useFlashBoardStore } from '../../src/stores/flashboardStore';
import { useMediaStore } from '../../src/stores/mediaStore';
import type {
  MediaFile,
  MediaFolder,
} from '../../src/stores/mediaStore/types';
import type {
  DockStoreSnapshot,
  FlashBoardStoreSnapshot,
  MediaStoreState,
  StoryboardStoreSnapshot,
  TimelineStoreState,
} from '../../src/stores/historyStore/historyStoreTypes';
import type { TimelineClip } from '../../src/types/timeline';

const exactQuote = {
  amount: 5,
  exact: true as const,
  pricingVersion: 'telemetry-price-v1',
  unit: 'hosted-credit' as const,
};

const catalog: CatalogEntry[] = [{
  service: 'cloud',
  providerId: 'cloud-kling',
  name: 'Hosted Kling',
  description: 'Exact hosted telemetry route',
  versions: ['latest'],
  modes: ['std'],
  durations: [5],
  aspectRatios: ['16:9'],
  supportsTextToVideo: true,
  supportsImageToVideo: true,
  supportsGenerateAudio: true,
  maxReferenceImages: 1,
  outputType: 'video',
}];

function generationBrief(): StoryboardGenerationBrief {
  return {
    schemaVersion: 1,
    id: 'brief-generation-undo-telemetry',
    sceneId: 'scene-generation-undo-telemetry',
    revision: 1,
    prompt: 'Private generation prompt that telemetry must never contain.',
    durationSeconds: 5,
    aspectRatio: '16:9',
    referenceMediaFileIds: ['private-reference-media'],
    capabilityPolicy: { mediaType: 'video' },
    createdAt: 1,
  };
}

function storyboardState(): StoryboardProjectState {
  return {
    schemaVersion: 1,
    plans: {
      'plan-generation-undo-telemetry': {
        schemaVersion: 1,
        id: 'plan-generation-undo-telemetry',
        title: 'Generation undo and telemetry',
        sceneIds: ['scene-generation-undo-telemetry'],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    scenes: {
      'scene-generation-undo-telemetry': {
        schemaVersion: 1,
        id: 'scene-generation-undo-telemetry',
        planId: 'plan-generation-undo-telemetry',
        title: 'Generated scene',
        description: 'Attach one generated result.',
        targetDurationSeconds: 5,
        status: 'review',
        generationBriefId: 'brief-generation-undo-telemetry',
        filledClipIds: [],
        evidenceRefIds: [],
        variantSetIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    generationBriefs: {
      'brief-generation-undo-telemetry': generationBrief(),
    },
    candidates: {},
    evidenceRefs: {},
    coverageBySceneId: {},
    variantSets: {},
    variantOptions: {},
    decisions: {},
    templates: {},
  };
}

function request(key: string): FlashBoardGenerationRequest {
  return {
    service: 'cloud',
    providerId: 'cloud-kling',
    version: 'latest',
    idempotencyKey: key,
    outputType: 'video',
    prompt: 'Private restore prompt.',
    duration: 5,
    aspectRatio: '16:9',
    referenceMediaFileIds: ['private-restore-reference'],
  };
}

function generationRecord(
  id: string,
  generationRequest: FlashBoardGenerationRequest,
  index: number,
): FlashBoardActiveGenerationRecord {
  return {
    id,
    kind: 'generation',
    createdAt: 20 + index,
    updatedAt: 20 + index,
    request: generationRequest,
    job: { status: 'draft' },
  };
}

function generatedAttachmentClip(file: File): TimelineClip {
  return {
    id: 'clip-generated-attachment',
    trackId: 'track-generation-undo',
    name: 'Generated attachment',
    file,
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: {
      type: 'video',
      file,
      mediaFileId: 'media-generated-attachment',
      naturalDuration: 5,
    },
    mediaFileId: 'media-generated-attachment',
    transform: {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    effects: [],
  };
}

beforeEach(() => {
  resetStoryboardTelemetryForTests();
  setHistoryDisabledForDebug(false);
  setHistoryCallbacks({
    flushPendingCapture: () => undefined,
    suppressCaptures: () => undefined,
  });
  useHistoryStore.setState({
    nodes: {},
    rootId: null,
    activeNodeId: null,
    lastVisitedChildByNodeId: {},
    eventLog: [],
    isApplying: false,
    batchId: null,
    batchLabel: null,
  });
});

afterEach(() => {
  resetStoryboardTelemetryForTests();
  getHistoryStateView().clearHistory();
  flashBoardMediaBridge.hydrateMetadata({});
  useFlashBoardStore.setState({
    activeGenerationRecords: [],
    selectedActiveGenerationRecordIds: [],
    composer: createDefaultFlashBoardComposer(),
    hoveredComposerReference: null,
  });
  vi.restoreAllMocks();
});

describe('storyboard generation telemetry and attachment undo', () => {
  it('keeps per-output import failure retryable without failing the completed job', async () => {
    useFlashBoardStore.setState({
      activeGenerationRecords: [{
        id: 'private-import-record',
        kind: 'generation',
        createdAt: 1,
        updatedAt: 1,
        request: request('private-import-request-key'),
        job: {
          status: 'completed',
          remoteTaskId: 'private-import-task',
          completedAt: 1,
        },
        outputs: [{
          id: 'private-output-1',
          mediaType: 'video',
          availability: 'completed',
        }, {
          id: 'private-output-2',
          mediaType: 'video',
          availability: 'completed',
        }],
      }],
      selectedActiveGenerationRecordIds: [],
      composer: createDefaultFlashBoardComposer(),
      hoveredComposerReference: null,
    });
    const folders: MediaFolder[] = [];
    const createFolder = vi.fn((
      name: string,
      parentId: string | null = null,
    ): MediaFolder => {
      const folder: MediaFolder = {
        id: `folder-${name.toLowerCase().replace(/\s+/g, '-')}`,
        name,
        parentId,
        createdAt: 1,
        updatedAt: 1,
      };
      folders.push(folder);
      return folder;
    });
    const imported = (index: number): MediaFile => ({
      id: `media-import-retry-${index}`,
      name: `generated-${index}.mp4`,
      type: 'video',
      parentId: 'folder-video',
      createdAt: index,
      file: new File([`video-${index}`], `generated-${index}.mp4`, {
        type: 'video/mp4',
      }),
      url: `blob:generated-${index}`,
      duration: 5,
    });
    const importFile = vi.fn()
      .mockResolvedValueOnce(imported(1))
      .mockRejectedValueOnce(
        new Error('private output import error with provider credential'),
      )
      .mockResolvedValueOnce(imported(2));
    vi.spyOn(useMediaStore, 'getState').mockReturnValue({
      folders,
      files: [],
      createFolder,
      importFile,
    } as unknown as ReturnType<typeof useMediaStore.getState>);
    const assets = [{
      file: new File(['one'], 'one.mp4', { type: 'video/mp4' }),
      mediaType: 'video' as const,
      outputId: 'private-output-1',
    }, {
      file: new File(['two'], 'two.mp4', { type: 'video/mp4' }),
      mediaType: 'video' as const,
      outputId: 'private-output-2',
    }];

    await expect(flashBoardMediaBridge.importGeneratedAssets(
      'private-import-record',
      assets,
    )).rejects.toThrow('private output import error');

    const partial = useFlashBoardStore.getState().activeGenerationRecords[0]!;
    expect(partial).toMatchObject({
      job: {
        status: 'completed',
        remoteTaskId: 'private-import-task',
      },
      results: [{
        outputId: 'private-output-1',
        mediaFileId: 'media-import-retry-1',
      }],
      outputs: [{
        id: 'private-output-1',
        importStatus: 'completed',
        mediaFileId: 'media-import-retry-1',
      }, {
        id: 'private-output-2',
        importStatus: 'failed',
        importError: 'private output import error with provider credential',
      }],
    });
    expect(readStoryboardTelemetryJournal()).toEqual([
      expect.objectContaining({
        name: 'generation.import_failed',
        attributes: {
          failedCount: 1,
          reason: 'import',
        },
      }),
    ]);
    expect(JSON.stringify(readStoryboardTelemetryJournal()))
      .not.toContain('private');

    await expect(flashBoardMediaBridge.importGeneratedAssets(
      'private-import-record',
      assets,
    )).resolves.toMatchObject([{
      outputId: 'private-output-1',
      mediaFileId: 'media-import-retry-1',
    }, {
      outputId: 'private-output-2',
      mediaFileId: 'media-import-retry-2',
    }]);
    const completed = useFlashBoardStore.getState().activeGenerationRecords[0]!;
    expect(completed.job?.status).toBe('completed');
    expect(completed.results).toHaveLength(2);
    expect(completed.outputs).toEqual([
      expect.objectContaining({
        id: 'private-output-1',
        importStatus: 'completed',
        mediaFileId: 'media-import-retry-1',
      }),
      expect.objectContaining({
        id: 'private-output-2',
        importStatus: 'completed',
        importError: undefined,
        mediaFileId: 'media-import-retry-2',
      }),
    ]);
    expect(importFile).toHaveBeenCalledTimes(3);
    expect(readStoryboardTelemetryJournal()).toHaveLength(1);
  });

  it('emits only aggregate submission and restore telemetry under partial failure', async () => {
    const prepared = await prepareStoryboardGeneration({
      availability: { hostedAvailable: true },
      brief: generationBrief(),
      candidateCount: 4,
      catalogEntries: catalog,
      now: 10,
      pricingPort: () => exactQuote,
      projectId: 'private-project-id',
      referenceMediaTypes: {
        'private-reference-media': 'image',
      },
      userId: 'private-user-id',
    });
    const approval = await approvePreparedStoryboardGeneration(prepared, {
      explicitUserApproval: true,
      maxSpend: exactQuote.amount * prepared.candidateCount,
      now: 10,
      priceUnit: exactQuote.unit,
      projectId: 'private-project-id',
      userId: 'private-user-id',
    });
    const records: FlashBoardActiveGenerationRecord[] = [];
    const submission = await submitPreparedStoryboardGeneration({
      now: 20,
      ports: {
        createRecord: (entryRequest) => {
          const index = prepared.entries.findIndex(
            (entry) => entry.generationRequestKey === entryRequest.idempotencyKey,
          );
          const record = generationRecord(
            `private-record-${index}`,
            entryRequest,
            index,
          );
          records.push(record);
          return record;
        },
        listRecords: () => records,
        startRecord: (recordId) => {
          const record = records.find((entry) => entry.id === recordId)!;
          if (recordId === 'private-record-2') {
            throw new Error('private provider transport error');
          }
          record.job = { status: 'queued' };
          return record;
        },
      },
      prepared,
      pricingPort: () => exactQuote,
      projectId: 'private-project-id',
      state: storyboardState(),
      token: approval.token,
      userId: 'private-user-id',
    });
    expect(submission.status).toBe('partial');

    const restoreActions: StoryboardGenerationRestoreAction[] = [
      {
        kind: 'resubmit-idempotently',
        recordId: 'private-restore-success',
        request: request('private-restore-key-success'),
      },
      {
        kind: 'resubmit-idempotently',
        recordId: 'private-restore-failure',
        request: request('private-restore-key-failure'),
      },
      {
        kind: 'resume',
        recordId: 'private-restore-resume',
        remoteTaskId: 'private-remote-task',
        request: request('private-restore-key-resume'),
      },
      {
        kind: 'needs-confirmation',
        reason: 'private unsafe replay reason',
        recordId: 'private-restore-confirmation',
      },
      {
        kind: 'awaiting-import',
        recordId: 'private-awaiting-import',
      },
    ];
    const restored = executeStoryboardGenerationRestoreActions(restoreActions, {
      hasJob: () => false,
      resume: vi.fn(),
      submit: ({ recordId }) => {
        if (recordId === 'private-restore-failure') {
          throw new Error('private restore transport error');
        }
      },
    });
    expect(restored).toMatchObject({
      executedRecordIds: [
        'private-restore-success',
        'private-restore-resume',
      ],
      failed: [{
        error: 'private restore transport error',
        recordId: 'private-restore-failure',
      }],
      needsConfirmationRecordIds: ['private-restore-confirmation'],
    });

    const journal = readStoryboardTelemetryJournal();
    expect(journal).toEqual([
      expect.objectContaining({
        name: 'generation.submitted',
        attributes: {
          count: 4,
          failedCount: 1,
          status: 'partial',
          succeededCount: 3,
        },
      }),
      expect.objectContaining({
        name: 'generation.restored',
        attributes: {
          count: 5,
          failedCount: 1,
          succeededCount: 2,
        },
      }),
    ]);
    const serialized = JSON.stringify(journal);
    for (const forbidden of [
      'Private generation prompt',
      'private-project-id',
      'private-user-id',
      'private-record',
      'private-restore',
      'private-reference',
      'private provider transport error',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('emits only allowlisted cancellation dispositions for every lifecycle', () => {
    const preparedCandidate = {
      schemaVersion: 1 as const,
      id: 'private-candidate-prepared',
      sceneId: 'scene-generation-undo-telemetry',
      kind: 'generated-video' as const,
      state: 'awaiting-approval' as const,
      generationBriefRevision: 1,
      generationRequestKey: 'private-cancel-prepared-key',
      sourceMomentHandles: [],
      createdAt: 1,
    };
    const processingCandidate = {
      ...preparedCandidate,
      id: 'private-candidate-processing',
      state: 'processing' as const,
      generationRequestKey: 'private-cancel-processing-key',
      generationRecordId: 'private-cancel-processing-record',
    };
    const completedCandidate = {
      ...preparedCandidate,
      id: 'private-candidate-completed',
      state: 'processing' as const,
      generationRequestKey: 'private-cancel-completed-key',
      generationRecordId: 'private-cancel-completed-record',
    };
    const current = storyboardState();
    current.candidates = {
      [preparedCandidate.id]: preparedCandidate,
      [processingCandidate.id]: processingCandidate,
      [completedCandidate.id]: completedCandidate,
    };
    const processingRecord: FlashBoardActiveGenerationRecord = {
      id: 'private-cancel-processing-record',
      kind: 'generation',
      createdAt: 1,
      updatedAt: 1,
      request: request('private-cancel-processing-key'),
      job: {
        status: 'processing',
        remoteTaskId: 'private-cancel-remote-task',
      },
    };
    const completedRecord: FlashBoardActiveGenerationRecord = {
      id: 'private-cancel-completed-record',
      kind: 'generation',
      createdAt: 1,
      updatedAt: 1,
      request: request('private-cancel-completed-key'),
      job: { status: 'completed' },
      results: [{
        outputId: 'private-cancel-completed-output',
        mediaFileId: 'private-cancel-completed-media',
        mediaType: 'video',
        duration: 5,
      }],
    };
    const records = new Map([
      [processingRecord.id, processingRecord],
      [completedRecord.id, completedRecord],
    ]);
    const ports = {
      cancelJob: () => ({
        billingMayContinue: true,
        disposition: 'cancel-requested' as const,
        recordId: processingRecord.id,
        remoteTaskId: 'private-cancel-remote-task',
      }),
      getRecord: (recordId: string) => records.get(recordId),
      updateJob: vi.fn(),
    };

    expect(cancelStoryboardGeneration({
      candidateId: preparedCandidate.id,
      ports,
      state: current,
    }).disposition).toBe('canceled-before-submission');
    expect(cancelStoryboardGeneration({
      candidateId: processingCandidate.id,
      ports,
      state: current,
    }).disposition).toBe('cancel-requested');
    expect(cancelStoryboardGeneration({
      candidateId: completedCandidate.id,
      ports,
      state: current,
    }).disposition).toBe('completed-billable');

    expect(readStoryboardTelemetryJournal().map((event) => ({
      name: event.name,
      attributes: event.attributes,
    }))).toEqual([{
      name: 'generation.cancelled',
      attributes: { status: 'canceled-before-submission' },
    }, {
      name: 'generation.cancelled',
      attributes: { status: 'cancel-requested' },
    }, {
      name: 'generation.cancelled',
      attributes: { status: 'completed-billable' },
    }]);
    const serialized = JSON.stringify(readStoryboardTelemetryJournal());
    for (const forbidden of [
      'private-candidate',
      'private-cancel',
      'private-cancel-remote-task',
      'private-cancel-completed-media',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('undoes only the timeline attachment while retaining asset and billing evidence', () => {
    const generatedFile = new File(
      ['generated media bytes'],
      'generated-attachment.mp4',
      { type: 'video/mp4' },
    );
    let timeline: TimelineStoreState = {
      clips: [],
      tracks: [{
        id: 'track-generation-undo',
        name: 'Generated video',
        type: 'video',
        height: 80,
        muted: false,
        visible: true,
        solo: false,
      }],
      selectedClipIds: new Set(),
      zoom: 50,
      scrollX: 0,
      layers: [],
      selectedLayerId: null,
      clipKeyframes: new Map(),
      markers: [],
      isExporting: false,
    };
    let media: MediaStoreState = {
      files: [{
        id: 'media-generated-attachment',
        name: 'Generated attachment',
        type: 'video',
        parentId: null,
        createdAt: 10,
        file: generatedFile,
        url: 'blob:generated-attachment',
        duration: 5,
      }],
      compositions: [],
      folders: [],
      selectedIds: [],
      expandedFolderIds: [],
      textItems: [],
      solidItems: [],
      mathSceneItems: [],
      motionShapeItems: [],
      signalAssets: [],
      signalArtifacts: [],
      signalGraphs: [],
      signalOperators: [],
    };
    let flashboard: FlashBoardStoreSnapshot = {
      activeGenerationRecords: [{
        id: 'record-generated-attachment',
        kind: 'generation',
        createdAt: 10,
        updatedAt: 10,
        request: request('storyboard-generation:attachment'),
        job: { status: 'completed', completedAt: 10 },
        outputs: [{
          id: 'output-generated-attachment',
          mediaType: 'video',
          availability: 'completed',
          importStatus: 'completed',
          mediaFileId: 'media-generated-attachment',
        }],
        results: [{
          outputId: 'output-generated-attachment',
          mediaFileId: 'media-generated-attachment',
          mediaType: 'video',
          duration: 5,
        }],
      }],
      selectedActiveGenerationRecordIds: [],
      composer: createDefaultFlashBoardComposer(),
    };
    let storyboard: StoryboardStoreSnapshot = storyboardState();
    storyboard = {
      ...storyboard,
      candidates: {
        'candidate-generated-attachment': {
          schemaVersion: 1,
          id: 'candidate-generated-attachment',
          sceneId: 'scene-generation-undo-telemetry',
          kind: 'generated-video',
          state: 'ready',
          generationBriefRevision: 1,
          generationRequestKey: 'storyboard-generation:attachment',
          generationRecordId: 'record-generated-attachment',
          outputId: 'output-generated-attachment',
          mediaFileId: 'media-generated-attachment',
          sourceMomentHandles: [],
          actualCredits: 5,
          createdAt: 10,
        },
      },
    };
    let dock: DockStoreSnapshot = {
      layout: {
        root: {
          kind: 'tab-group',
          id: 'root',
          panels: [],
          activeIndex: 0,
        },
        floatingPanels: [],
        panelZoom: {},
      },
    };

    initHistoryStoreRefs({
      timeline: {
        getState: () => timeline,
        setState: (patch) => {
          timeline = { ...timeline, ...patch };
        },
      },
      media: {
        getState: () => media,
        setState: (patch) => {
          media = { ...media, ...patch };
        },
      },
      dock: {
        getState: () => dock,
        setState: (patch) => {
          dock = { ...dock, ...patch };
        },
      },
      flashboard: {
        getState: () => flashboard,
        setState: (patch) => {
          flashboard = { ...flashboard, ...patch };
        },
      },
      storyboard: {
        getState: () => storyboard,
        setState: (next) => {
          storyboard = next;
        },
      },
    });

    getHistoryStateView().captureSnapshot('Imported generation is ready');
    timeline = {
      ...timeline,
      clips: [generatedAttachmentClip(generatedFile)],
      selectedClipIds: new Set(['clip-generated-attachment']),
    };
    storyboard = {
      ...storyboard,
      scenes: {
        ...storyboard.scenes,
        'scene-generation-undo-telemetry': {
          ...storyboard.scenes['scene-generation-undo-telemetry'],
          status: 'filled',
          selectedCandidateId: 'candidate-generated-attachment',
          filledClipIds: ['clip-generated-attachment'],
        },
      },
      candidates: {
        ...storyboard.candidates,
        'candidate-generated-attachment': {
          ...storyboard.candidates['candidate-generated-attachment'],
          state: 'accepted',
        },
      },
    };
    getHistoryStateView().captureSnapshot('Attach generated candidate');

    expect(getHistoryStateView().undo()).toEqual({
      operation: 'undo',
      label: 'Attach generated candidate',
    });
    expect(timeline.clips).toEqual([]);
    expect(media.files).toHaveLength(1);
    expect(media.files[0]).toMatchObject({
      id: 'media-generated-attachment',
      url: 'blob:generated-attachment',
    });
    expect(media.files[0]?.file).toBe(generatedFile);
    expect(flashboard.activeGenerationRecords).toHaveLength(1);
    expect(flashboard.activeGenerationRecords[0]).toMatchObject({
      id: 'record-generated-attachment',
      job: {
        status: 'completed',
      },
      outputs: [{
        id: 'output-generated-attachment',
        mediaFileId: 'media-generated-attachment',
        importStatus: 'completed',
      }],
    });
    expect(flashboard.activeGenerationRecords[0]?.job?.refund).toBeUndefined();
    expect(storyboard.candidates['candidate-generated-attachment']).toMatchObject({
      state: 'ready',
      mediaFileId: 'media-generated-attachment',
      actualCredits: 5,
    });
    expect(storyboard.scenes['scene-generation-undo-telemetry']).toMatchObject({
      filledClipIds: [],
      status: 'review',
    });

    expect(getHistoryStateView().redo()).toEqual({
      operation: 'redo',
      label: 'Attach generated candidate',
    });
    expect(timeline.clips).toHaveLength(1);
    expect(media.files[0]?.file).toBe(generatedFile);
    expect(flashboard.activeGenerationRecords[0]?.job?.refund).toBeUndefined();
    expect(storyboard.candidates['candidate-generated-attachment'].state)
      .toBe('accepted');
  });
});
