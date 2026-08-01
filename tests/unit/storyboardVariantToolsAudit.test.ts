import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  executeAITool,
  storyboardToolDefinitions,
} from '../../src/services/aiTools';
import { getRegisteredToolHandlerNames } from '../../src/services/aiTools/handlers';
import {
  checkToolAccess,
  getToolPolicy,
} from '../../src/services/aiTools/policy';
import { getRegisteredToolPolicyNames } from '../../src/services/aiTools/policy/registry';
import { MODIFYING_TOOLS } from '../../src/services/aiTools/types';
import {
  getStoryboardProjectSnapshot,
  hydrateStoryboardProjectState,
  resetStoryboardProjectState,
  useStoryboardStore,
} from '../../src/stores/storyboardStore';
import { useMediaStore } from '../../src/stores/mediaStore';
import type {
  Composition,
  MediaFile,
} from '../../src/stores/mediaStore/types';
import { useDockStore } from '../../src/stores/dockStore';
import {
  getHistoryStateView,
  initHistoryStoreRefs,
  setHistoryDisabledForDebug,
} from '../../src/stores/historyStore';
import { useTimelineStore } from '../../src/stores/timeline';
import type {
  TimelineVariantOption,
  TimelineVariantSet,
} from '../../src/services/storyboard/contracts';
import {
  captureVariantRangeSnapshot,
  createVariantTimelineSourceFromComposition,
  fingerprintVariantRangeSnapshot,
} from '../../src/services/storyboard/variants';
import {
  createStoryboardReleaseJourneyFixture,
  RELEASE_COMPOSITION_ID,
} from '../fixtures/storyboard/releaseJourney';

const VARIANT_TOOL_NAMES = [
  'createTimelineVariantSet',
  'addTimelineVariantOption',
  'materializeTimelineVariantOption',
  'listTimelineVariantOptions',
  'commitTimelineVariantOption',
  'archiveTimelineVariantSet',
] as const;

const MUTATING_VARIANT_TOOL_NAMES = VARIANT_TOOL_NAMES.filter(
  (name) => name !== 'listTimelineVariantOptions',
);

function definition(name: typeof VARIANT_TOOL_NAMES[number]) {
  const found = storyboardToolDefinitions.find(
    (entry) => entry.function.name === name,
  );
  if (!found) throw new Error(`Missing definition: ${name}`);
  return found.function.parameters as {
    properties: Record<string, {
      properties?: Record<string, unknown>;
      required?: string[];
    }>;
    required: string[];
  };
}

function asVariantSet(data: unknown): TimelineVariantSet {
  return data as TimelineVariantSet;
}

function asVariantOption(data: unknown): TimelineVariantOption {
  return data as TimelineVariantOption;
}

describe('WP10 semantic timeline-variant tool surface', () => {
  it('keeps definition, handler, policy, and mutation registries in parity', () => {
    const defined = new Set(
      storyboardToolDefinitions.map((entry) => entry.function.name),
    );
    const handled = new Set(getRegisteredToolHandlerNames());
    const policies = new Set(getRegisteredToolPolicyNames());

    for (const name of VARIANT_TOOL_NAMES) {
      expect(defined.has(name), `${name} definition`).toBe(true);
      expect(handled.has(name), `${name} handler`).toBe(true);
      expect(policies.has(name), `${name} policy`).toBe(true);
      expect(getToolPolicy(name), `${name} policy entry`).toBeDefined();
    }

    expect(MODIFYING_TOOLS.has('listTimelineVariantOptions')).toBe(false);
    for (const name of MUTATING_VARIANT_TOOL_NAMES) {
      expect(MODIFYING_TOOLS.has(name), `${name} mutation class`).toBe(true);
      expect(getToolPolicy(name)?.readOnly, `${name} readOnly class`).toBe(false);
    }
    expect(getToolPolicy('listTimelineVariantOptions')?.readOnly).toBe(true);
  });

  it('exposes the complete portable fragment and boundary-policy schemas', () => {
    expect(definition('createTimelineVariantSet').required)
      .toEqual(['title', 'sceneIds']);
    expect(definition('addTimelineVariantOption').required)
      .toEqual(['variantSetId', 'option']);

    const optionSchema = definition('addTimelineVariantOption')
      .properties.option;
    expect(optionSchema.required)
      .toEqual(['title', 'rationale', 'state', 'fragment', 'candidateIds']);

    const optionProperties = optionSchema.properties as Record<string, {
      enum?: string[];
      required?: string[];
    }>;
    expect(optionProperties.state?.enum).toEqual([
      'planned',
      'building',
      'ready',
      'failed',
      'rejected',
      'accepted',
    ]);
    expect(optionProperties.fragment?.required).toEqual([
      'schemaVersion',
      'durationSeconds',
      'tracks',
      'clips',
      'links',
      'keyframes',
      'effects',
      'masks',
      'transitions',
      'markers',
      'annotations',
      'sceneIds',
      'candidateIds',
      'warnings',
    ]);

    const commitProperties = definition('commitTimelineVariantOption')
      .properties as Record<string, { enum?: string[] }>;
    expect(commitProperties.boundaryPolicy?.enum).toEqual([
      'preserve',
      'rebuild',
      'drop-with-warning',
    ]);
  });

  it('allows only planning-state mutations in Plan mode and only listing in read-only mode', () => {
    for (const name of [
      'createTimelineVariantSet',
      'addTimelineVariantOption',
      'archiveTimelineVariantSet',
      'listTimelineVariantOptions',
    ]) {
      expect(
        checkToolAccess(name, 'chat', { executionMode: 'plan' }),
        `${name} should be available in Plan mode`,
      ).toMatchObject({ allowed: true });
    }
    for (const name of [
      'materializeTimelineVariantOption',
      'commitTimelineVariantOption',
    ]) {
      expect(
        checkToolAccess(name, 'chat', { executionMode: 'plan' }),
        `${name} must not mutate real editor state in Plan mode`,
      ).toMatchObject({ allowed: false });
    }

    expect(checkToolAccess(
      'listTimelineVariantOptions',
      'chat',
      { executionMode: 'read-only' },
    )).toMatchObject({ allowed: true });
    for (const name of MUTATING_VARIANT_TOOL_NAMES) {
      expect(
        checkToolAccess(name, 'chat', { executionMode: 'read-only' }),
        `${name} must fail in read-only mode`,
      ).toMatchObject({ allowed: false });
    }
  });
});

describe('WP10 semantic timeline-variant tool execution boundary', () => {
  let previousCompositions: Composition[];
  let previousActiveCompositionId: string | null;
  let previousOpenCompositionIds: string[];
  let previousOpenCompositionTab: ReturnType<typeof useMediaStore.getState>['openCompositionTab'];
  let previousTimeline: ReturnType<typeof useTimelineStore.getState>['getSerializableState'] extends
    () => infer T ? T : never;
  let previousRangeSelection: ReturnType<typeof useTimelineStore.getState>['timelineRangeSelection'];
  let previousStoryboard: ReturnType<typeof getStoryboardProjectSnapshot>;
  let fixture: Awaited<ReturnType<typeof createStoryboardReleaseJourneyFixture>>;
  let testMediaState: ReturnType<typeof useMediaStore.getState>;

  beforeEach(async () => {
    const media = useMediaStore.getState();
    previousStoryboard = getStoryboardProjectSnapshot();
    previousCompositions = structuredClone(media.compositions);
    previousActiveCompositionId = media.activeCompositionId;
    previousOpenCompositionIds = Array.isArray(media.openCompositionIds)
      ? [...media.openCompositionIds]
      : [];
    previousOpenCompositionTab = media.openCompositionTab;
    previousTimeline = structuredClone(
      useTimelineStore.getState().getSerializableState(),
    );
    previousRangeSelection = useTimelineStore.getState().timelineRangeSelection
      ? structuredClone(useTimelineStore.getState().timelineRangeSelection)
      : null;
    fixture = await createStoryboardReleaseJourneyFixture();
    resetStoryboardProjectState();
    const releaseFiles: MediaFile[] = [
      ['before', 10],
      ['selected', 10],
      ['after', 10],
    ].map(([suffix, duration], index) => ({
      id: `media-release-${suffix}`,
      name: `release-${suffix}`,
      type: 'video',
      parentId: null,
      createdAt: index + 1,
      url: `memory://release-${suffix}`,
      duration: Number(duration),
      width: 1920,
      height: 1080,
      fps: 30,
    }));
    testMediaState = {
      ...media,
      files: releaseFiles,
      compositions: [structuredClone(fixture.baseComposition)],
      activeCompositionId: RELEASE_COMPOSITION_ID,
      openCompositionIds: [RELEASE_COMPOSITION_ID],
      openCompositionTab: vi.fn(async () => undefined),
    };
    vi.mocked(useMediaStore.getState).mockImplementation(() => testMediaState);
    vi.mocked(useMediaStore.setState).mockImplementation((update) => {
      const patch = typeof update === 'function'
        ? update(testMediaState)
        : update;
      testMediaState = {
        ...testMediaState,
        ...patch,
      };
    });
    useMediaStore.setState({
      compositions: [structuredClone(fixture.baseComposition)],
      activeCompositionId: RELEASE_COMPOSITION_ID,
      openCompositionIds: [RELEASE_COMPOSITION_ID],
      openCompositionTab: vi.fn(async () => undefined),
    });
    await useTimelineStore.getState().loadState(
      structuredClone(fixture.baseComposition.timelineData),
    );
    useMediaStore.setState({
      compositions: [structuredClone(fixture.baseComposition)],
      activeCompositionId: RELEASE_COMPOSITION_ID,
      openCompositionIds: [RELEASE_COMPOSITION_ID],
      openCompositionTab: vi.fn(async () => undefined),
    });
    useTimelineStore.getState().setTimelineRangeSelection({
      startTime: 10,
      endTime: 20,
      trackIds: ['release-video-track'],
    });
  });

  afterEach(async () => {
    hydrateStoryboardProjectState(previousStoryboard);
    useMediaStore.setState({
      compositions: previousCompositions,
      activeCompositionId: previousActiveCompositionId,
      openCompositionIds: previousOpenCompositionIds,
      openCompositionTab: previousOpenCompositionTab,
    });
    await useTimelineStore.getState().loadState(previousTimeline);
    useTimelineStore.getState().setTimelineRangeSelection(previousRangeSelection);
    getHistoryStateView().clearHistory();
    vi.restoreAllMocks();
  });

  async function createSet(
    includeLinked: unknown = false,
  ): Promise<TimelineVariantSet> {
    useMediaStore.setState({
      compositions: [structuredClone(fixture.baseComposition)],
      activeCompositionId: RELEASE_COMPOSITION_ID,
      openCompositionIds: [RELEASE_COMPOSITION_ID],
    });
    expect(useMediaStore.getState().activeCompositionId)
      .toBe(RELEASE_COMPOSITION_ID);
    const result = await executeAITool(
      'createTimelineVariantSet',
      {
        id: 'audit-variant-set',
        title: 'Audit range alternatives',
        sceneIds: ['release-scene'],
        includeLinked,
      },
      'chat',
      { executionMode: 'plan', guidedReplay: false, suppressHistory: true },
    );
    expect(result, JSON.stringify(result)).toMatchObject({ success: true });
    return asVariantSet(result.data);
  }

  async function addOption(
    set: TimelineVariantSet,
    option: TimelineVariantOption,
  ): Promise<TimelineVariantOption> {
    const result = await executeAITool(
      'addTimelineVariantOption',
      {
        variantSetId: set.id,
        option: structuredClone(option),
      },
      'chat',
      { executionMode: 'plan', guidedReplay: false, suppressHistory: true },
    );
    expect(result).toMatchObject({ success: true });
    return asVariantOption(result.data);
  }

  async function createThreeOptions(): Promise<{
    options: TimelineVariantOption[];
    set: TimelineVariantSet;
  }> {
    const set = await createSet();
    const options: TimelineVariantOption[] = [];
    for (const option of fixture.options) {
      options.push(await addOption(set, option));
    }
    return { options, set };
  }

  it('preflights an entire Plan-mode batch before its first state write', async () => {
    const result = await executeAITool(
      'executeBatch',
      {
        staggerDelayMs: 0,
        actions: [
          {
            tool: 'createTimelineVariantSet',
            args: {
              id: 'must-not-be-created',
              title: 'Would otherwise be valid',
              sceneIds: [],
              includeLinked: false,
            },
          },
          {
            tool: 'commitTimelineVariantOption',
            args: { optionId: 'missing' },
          },
        ],
      },
      'chat',
      { executionMode: 'plan', guidedReplay: false, suppressHistory: true },
    );

    expect(result.success, JSON.stringify(result)).toBe(false);
    expect(result.error).toContain('Batch rejected');
    expect(result.error).toContain('commitTimelineVariantOption');
    expect(useStoryboardStore.getState().variantSets['must-not-be-created'])
      .toBeUndefined();
  });

  it('fails closed on schema-invalid booleans instead of changing capture semantics', async () => {
    const result = await executeAITool(
      'createTimelineVariantSet',
      {
        id: 'invalid-boolean-set',
        title: 'Invalid includeLinked',
        sceneIds: [],
        includeLinked: 'false',
      },
      'chat',
      { executionMode: 'plan', guidedReplay: false, suppressHistory: true },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('includeLinked');
    expect(useStoryboardStore.getState().variantSets['invalid-boolean-set'])
      .toBeUndefined();
  });

  it('enforces exactly three unique registered options and honest listing', async () => {
    const set = await createSet();
    const first = await addOption(set, fixture.options[0]);

    const duplicate = await executeAITool(
      'addTimelineVariantOption',
      { variantSetId: set.id, option: structuredClone(fixture.options[0]) },
      'chat',
      { executionMode: 'plan', guidedReplay: false, suppressHistory: true },
    );
    expect(duplicate.success).toBe(false);
    expect(duplicate.error).toContain('already exists');

    const premature = await executeAITool(
      'materializeTimelineVariantOption',
      { optionId: first.id },
      'chat',
      { executionMode: 'normal', guidedReplay: false, suppressHistory: true },
    );
    expect(premature.success).toBe(false);
    expect(premature.error).toContain('exactly three');

    await addOption(set, fixture.options[1]);
    await addOption(set, fixture.options[2]);
    const fourth = {
      ...structuredClone(fixture.options[2]),
      id: 'release-option-d',
      title: 'Forbidden fourth option',
    };
    const overCapacity = await executeAITool(
      'addTimelineVariantOption',
      { variantSetId: set.id, option: fourth },
      'chat',
      { executionMode: 'plan', guidedReplay: false, suppressHistory: true },
    );
    expect(overCapacity.success).toBe(false);
    expect(overCapacity.error).toContain('exactly three');

    const listed = await executeAITool(
      'listTimelineVariantOptions',
      { variantSetId: set.id },
      'chat',
      { executionMode: 'read-only', guidedReplay: false, suppressHistory: true },
    );
    expect(listed.success).toBe(true);
    expect((listed.data as { options: TimelineVariantOption[] }).options)
      .toHaveLength(3);

    useStoryboardStore.setState((state) => {
      const variantOptions = { ...state.variantOptions };
      delete variantOptions[first.id];
      return { variantOptions };
    });
    const corruptList = await executeAITool(
      'listTimelineVariantOptions',
      { variantSetId: set.id },
      'chat',
      { executionMode: 'read-only', guidedReplay: false, suppressHistory: true },
    );
    expect(corruptList.success).toBe(false);
    expect(corruptList.error).toContain('references missing options');
  });

  it('keeps Plan mode non-mutating while normal mode materializes an isolated option', async () => {
    const { options, set } = await createThreeOptions();
    const baseBefore = structuredClone(
      useMediaStore.getState().compositions.find(
        (composition) => composition.id === RELEASE_COMPOSITION_ID,
      ),
    );

    const denied = await executeAITool(
      'materializeTimelineVariantOption',
      { optionId: options[0].id },
      'chat',
      { executionMode: 'plan', guidedReplay: false, suppressHistory: true },
    );
    expect(denied.success).toBe(false);
    expect(denied.error).toContain('Plan mode');
    expect(useMediaStore.getState().compositions).toHaveLength(1);

    const materialized = await executeAITool(
      'materializeTimelineVariantOption',
      { optionId: options[0].id },
      'chat',
      { executionMode: 'normal', guidedReplay: false, suppressHistory: true },
    );
    expect(materialized.success).toBe(true);
    expect(useMediaStore.getState().compositions.length).toBeGreaterThan(1);
    expect(useMediaStore.getState().compositions.find(
      (composition) => composition.id === RELEASE_COMPOSITION_ID,
    )).toEqual(baseBefore);
    expect(useStoryboardStore.getState().variantSets[set.id]?.status)
      .toBe('review');
  });

  it('rejects stale materialization and marks the set stale before any composition install', async () => {
    const { options, set } = await createThreeOptions();
    useTimelineStore.setState((state) => ({
      clips: state.clips.map((clip) => (
        clip.id === 'release-selected'
          ? { ...clip, duration: clip.duration - 1 }
          : clip
      )),
    }));
    const liveTimeline = useTimelineStore.getState().getSerializableState();
    expect(liveTimeline.clips.find(
      (clip) => clip.id === 'release-selected',
    )?.duration).toBe(9);
    expect(useMediaStore.getState().activeCompositionId)
      .toBe(RELEASE_COMPOSITION_ID);
    const liveSnapshot = captureVariantRangeSnapshot(
      createVariantTimelineSourceFromComposition({
        composition: {
          ...fixture.baseComposition,
          timelineData: liveTimeline,
        },
        scope: set.scope,
        boundaryPaddingSeconds: 1,
      }),
    );
    const liveFingerprints = await fingerprintVariantRangeSnapshot(liveSnapshot);
    expect(liveFingerprints.scope.value).not.toBe(set.baseFingerprint.value);

    const result = await executeAITool(
      'materializeTimelineVariantOption',
      { optionId: options[0].id },
      'chat',
      { executionMode: 'normal', guidedReplay: false, suppressHistory: true },
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('stale');
    expect(useStoryboardStore.getState().variantSets[set.id]?.status)
      .toBe('stale');
    expect(useMediaStore.getState().compositions).toHaveLength(1);
  });

  it('rejects unregistered options and invalid boundary policies without touching the base', async () => {
    const { options, set } = await createThreeOptions();
    const baseBefore = structuredClone(
      useMediaStore.getState().compositions[0],
    );
    const forged = {
      ...structuredClone(options[0]),
      id: 'forged-unregistered-option',
    };
    useStoryboardStore.getState().putVariantOption(forged);

    const unregistered = await executeAITool(
      'commitTimelineVariantOption',
      { optionId: forged.id },
      'chat',
      { executionMode: 'normal', guidedReplay: false, suppressHistory: true },
    );
    expect(unregistered.success).toBe(false);
    expect(unregistered.error).toContain('not registered');

    const invalidPolicy = await executeAITool(
      'commitTimelineVariantOption',
      { optionId: options[0].id, boundaryPolicy: 'overwrite-everything' },
      'chat',
      { executionMode: 'normal', guidedReplay: false, suppressHistory: true },
    );
    expect(invalidPolicy.success).toBe(false);
    expect(invalidPolicy.error).toContain('boundaryPolicy');
    expect(useMediaStore.getState().compositions[0]).toEqual(baseBefore);
    expect(useStoryboardStore.getState().variantSets[set.id]?.status)
      .toBe('building');
  });

  it('rolls a standalone commit back when the default post-apply verifier detects drift', async () => {
    const { options, set } = await createThreeOptions();
    const baseBefore = structuredClone(
      useMediaStore.getState().compositions[0],
    );
    const storyboardBefore = getStoryboardProjectSnapshot();

    setHistoryDisabledForDebug(false);
    getHistoryStateView().clearHistory();
    initHistoryStoreRefs({
      timeline: {
        getState: useTimelineStore.getState,
        setState: useTimelineStore.setState,
      },
      media: {
        getState: () => testMediaState as never,
        setState: (partial) => {
          testMediaState = {
            ...testMediaState,
            ...partial,
          };
        },
      },
      dock: {
        getState: useDockStore.getState,
        setState: useDockStore.setState,
      },
      storyboard: {
        getState: getStoryboardProjectSnapshot,
        setState: hydrateStoryboardProjectState,
      },
    });

    vi.mocked(useMediaStore.setState).mockImplementation((update) => {
      const patch = typeof update === 'function'
        ? update(testMediaState)
        : update;
      const compositions: Composition[] | undefined = patch.compositions?.map(
        (composition): Composition => {
          if (
            composition.id !== RELEASE_COMPOSITION_ID
            || !composition.timelineData
          ) {
            return composition;
          }
          return {
            ...composition,
            timelineData: {
              ...composition.timelineData,
              duration: composition.timelineData.duration + 1,
            },
          };
        },
      );
      testMediaState = {
        ...testMediaState,
        ...patch,
        ...(compositions ? { compositions } : {}),
      };
    });

    const result = await executeAITool(
      'commitTimelineVariantOption',
      {
        optionId: options[0].id,
        boundaryPolicy: 'preserve',
      },
      'chat',
      { executionMode: 'normal', guidedReplay: false, suppressHistory: true },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain(
      'Committed base composition does not match the verified variant result',
    );
    expect(useMediaStore.getState().compositions[0]).toEqual(baseBefore);
    expect(getStoryboardProjectSnapshot()).toEqual(storyboardBefore);
    expect(useStoryboardStore.getState().variantSets[set.id]?.status)
      .toBe('building');
    expect(getHistoryStateView().batchId).toBeNull();
    expect(getHistoryStateView().undoStack).toHaveLength(0);
  });
});
