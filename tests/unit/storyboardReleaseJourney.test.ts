import { describe, expect, it, vi } from 'vitest';
import { buildFlashBoardChatSendPlan } from '../../src/components/panels/flashboard/FlashBoardChatSendPlanner';
import {
  buildStoryboardDecisionContinuationPrompt,
  createStoryboardDecisionRecord,
  resolveStoryboardDecisionRecord,
  validateStoryboardDecisionSelection,
} from '../../src/services/storyboard/decisions';
import {
  decodeStoryboardProjectState,
  encodeStoryboardProjectState,
} from '../../src/services/project/storyboard';
import {
  commitTimelineVariantOption,
  materializeTimelineVariantSet,
  type TimelineVariantCommitRuntimePorts,
} from '../../src/services/storyboard/variants';
import {
  createEmptyStoryboardVariantState,
  reduceStoryboardVariantState,
  restoreStoryboardVariantState,
  serializeStoryboardVariantState,
} from '../../src/stores/storyboardVariantStore';
import {
  createReleaseMaterializationIdFactory,
  createReleaseStoryboardProjectState,
  createStoryboardReleaseJourneyFixture,
} from '../fixtures/storyboard/releaseJourney';

describe('storyboard release journey', () => {
  it('flows from safe Plan 3 through a durable decision into three isolated options', async () => {
    const fixture = await createStoryboardReleaseJourneyFixture();
    const baseBefore = structuredClone(fixture.baseComposition);
    const plan = buildFlashBoardChatSendPlan({
      activeChatModelId: 'gpt-5-6-luna',
      canUseHostedChat: true,
      chatIntent: 'plan',
      chatMessages: [],
      chatPanelOpen: true,
      chatProvider: 'kie',
      chatTemperature: 0.7,
      decisionPolicy: 'milestones',
      effectiveChatPrompt: 'Prepare three options for the marked range.',
      hasHostedSession: true,
      hostedAIEnabled: true,
      isChatting: false,
      openAiReasoningEffort: 'medium',
      planThreeEnabled: true,
    });

    expect(plan.action).toBe('send');
    if (plan.action !== 'send') return;
    expect(plan.request).toMatchObject({
      intent: 'plan',
      decisionPolicy: 'milestones',
      toolExecutionMode: 'plan',
    });
    expect(plan.request.prompt).toContain('exactly three separate storyboard or range-variant options');
    expect(plan.request.prompt).toContain('without materializing real compositions');

    const decision = createStoryboardDecisionRecord({
      id: 'release-decision',
      kind: 'variant',
      question: 'Which marked-range direction should be materialized?',
      baseFingerprint: fixture.variantSet.baseFingerprint,
      options: fixture.options.map((option) => ({
        id: option.id,
        title: option.title,
        summary: option.rationale,
        tradeoffs: [],
      })),
      allowMultiple: false,
      allowFreeform: true,
    }, {
      createdAt: 11,
      sceneId: 'release-scene',
      variantSetId: fixture.variantSet.id,
    });
    const selection = {
      decisionId: decision.id,
      optionIds: ['release-option-b'],
    };
    expect(validateStoryboardDecisionSelection(
      decision,
      selection,
      fixture.variantSet.baseFingerprint,
    )).toMatchObject({ ok: true });
    const resolvedDecision = resolveStoryboardDecisionRecord(
      decision,
      selection,
      12,
    );
    expect(resolvedDecision.selectedOptionIds).toEqual(['release-option-b']);
    expect(buildStoryboardDecisionContinuationPrompt(
      decision,
      selection,
    )).toContain('Recompile this choice against the latest editor snapshot');

    const candidateStates = Object.fromEntries(
      Object.values(fixture.candidates).map((candidate) => [
        candidate.id,
        candidate.state,
      ]),
    );
    const materialized = materializeTimelineVariantSet({
      candidateStates,
      compositions: [fixture.baseComposition],
      idFactory: createReleaseMaterializationIdFactory(),
      options: fixture.options,
      rangeSnapshot: fixture.rangeSnapshot,
      variantSet: fixture.variantSet,
    });

    expect(materialized).toHaveLength(3);
    expect(new Set(
      materialized.map((result) => result.graph.rootCompositionId),
    ).size).toBe(3);
    expect(materialized.map((result) => result.option.state))
      .toEqual(['ready', 'ready', 'building']);
    expect(materialized.every((result) => result.playable)).toBe(true);
    expect(fixture.baseComposition).toEqual(baseBefore);
    for (const result of materialized) {
      const composition = result.graph.compositions.find(
        (entry) => entry.id === result.graph.rootCompositionId,
      );
      expect(composition?.timelineData?.clips.some(
        (clip) => clip.startTime === 10 && clip.duration === 10,
      )).toBe(true);
    }
  });

  it('reloads the open decision, three options, and canonical range snapshot', async () => {
    const fixture = await createStoryboardReleaseJourneyFixture();
    const decision = resolveStoryboardDecisionRecord(
      createStoryboardDecisionRecord({
        id: 'release-decision',
        kind: 'variant',
        question: 'Which option?',
        baseFingerprint: fixture.variantSet.baseFingerprint,
        options: fixture.options.map((option) => ({
          id: option.id,
          title: option.title,
          summary: option.rationale,
          tradeoffs: [],
        })),
      }, {
        createdAt: 11,
        sceneId: 'release-scene',
        variantSetId: fixture.variantSet.id,
      }),
      {
        decisionId: 'release-decision',
        optionIds: ['release-option-b'],
      },
      12,
    );
    const materialized = materializeTimelineVariantSet({
      candidateStates: {
        'candidate-option-b': 'ready',
        'candidate-option-c': 'processing',
      },
      compositions: [fixture.baseComposition],
      idFactory: createReleaseMaterializationIdFactory(),
      options: fixture.options,
      rangeSnapshot: fixture.rangeSnapshot,
      variantSet: fixture.variantSet,
    });
    const reviewSet = {
      ...fixture.variantSet,
      status: 'review' as const,
      optionIds: materialized.map((result) => result.option.id),
    };

    let workspace = createEmptyStoryboardVariantState();
    workspace = reduceStoryboardVariantState(workspace, {
      type: 'put-set',
      variantSet: reviewSet,
    });
    workspace = reduceStoryboardVariantState(workspace, {
      type: 'attach-snapshot',
      variantSetId: reviewSet.id,
      snapshot: fixture.rangeSnapshot,
    });
    for (const result of materialized) {
      workspace = reduceStoryboardVariantState(workspace, {
        type: 'put-option',
        option: result.option,
      });
    }
    const restoredWorkspace = restoreStoryboardVariantState(
      JSON.parse(serializeStoryboardVariantState(workspace)),
    );
    expect(restoredWorkspace).toEqual(workspace);
    expect(Object.keys(restoredWorkspace.variantOptions)).toHaveLength(3);
    expect(restoredWorkspace.rangeSnapshots[reviewSet.id])
      .toEqual(fixture.rangeSnapshot);

    const projectState = createReleaseStoryboardProjectState({
      decision,
      options: materialized.map((result) => result.option),
      variantSet: reviewSet,
    });
    const reloadedProject = decodeStoryboardProjectState(JSON.parse(
      JSON.stringify(encodeStoryboardProjectState(projectState)),
    )).state;
    expect(reloadedProject.decisions[decision.id]).toEqual(decision);
    expect(reloadedProject.scenes['release-scene'].variantSetIds)
      .toContain(reviewSet.id);
    expect(Object.keys(reloadedProject.variantOptions)).toHaveLength(3);
    expect(reloadedProject.variantSets[reviewSet.id]).toMatchObject({
      status: 'review',
      optionIds: [
        'release-option-a',
        'release-option-b',
        'release-option-c',
      ],
    });
  });

  it('commits the selected option as one undo checkpoint and reloads the result', async () => {
    const fixture = await createStoryboardReleaseJourneyFixture();
    const baseBefore = structuredClone(fixture.baseComposition);
    const decision = resolveStoryboardDecisionRecord(
      createStoryboardDecisionRecord({
        id: 'release-decision',
        kind: 'variant',
        question: 'Which option?',
        baseFingerprint: fixture.variantSet.baseFingerprint,
        options: fixture.options.map((option) => ({
          id: option.id,
          title: option.title,
          summary: option.rationale,
          tradeoffs: [],
        })),
      }, {
        createdAt: 11,
        sceneId: 'release-scene',
        variantSetId: fixture.variantSet.id,
      }),
      {
        decisionId: 'release-decision',
        optionIds: ['release-option-b'],
      },
      12,
    );
    const storyboardBefore = createReleaseStoryboardProjectState({
      candidates: fixture.candidates,
      decision,
      options: fixture.options,
      variantSet: fixture.variantSet,
    });
    let currentComposition = structuredClone(fixture.baseComposition);
    let currentStoryboard = structuredClone(storyboardBefore);
    let undoCheckpoint: {
      composition: typeof currentComposition;
      storyboard: typeof currentStoryboard;
    } | undefined;
    let batchesStarted = 0;
    let batchesEnded = 0;
    let batchesCanceled = 0;
    let verificationCalls = 0;
    const ports: TimelineVariantCommitRuntimePorts = {
      listCompositions: () => [currentComposition],
      getStoryboardState: () => currentStoryboard,
      applyBaseComposition: (composition) => {
        currentComposition = structuredClone(composition);
      },
      applyStoryboardState: (state) => {
        currentStoryboard = structuredClone(state);
      },
      markVariantSetStale: vi.fn(),
      startHistoryBatch: () => {
        batchesStarted += 1;
        undoCheckpoint = {
          composition: structuredClone(currentComposition),
          storyboard: structuredClone(currentStoryboard),
        };
        return { opened: true };
      },
      endHistoryBatch: () => {
        batchesEnded += 1;
      },
      cancelHistoryBatch: () => {
        batchesCanceled += 1;
        if (undoCheckpoint) {
          currentComposition = structuredClone(undoCheckpoint.composition);
          currentStoryboard = structuredClone(undoCheckpoint.storyboard);
        }
      },
      verifyComplete: async (result) => {
        verificationCalls += 1;
        return {
          ok: result.variantSet.status === 'committed'
            && result.option.state === 'accepted',
        };
      },
    };

    const result = await commitTimelineVariantOption({
      boundaryPolicy: 'preserve',
      candidateStates: {
        'candidate-option-b': 'ready',
        'candidate-option-c': 'processing',
      },
      compositions: [fixture.baseComposition],
      currentRangeSnapshot: fixture.rangeSnapshot,
      idFactory: createReleaseMaterializationIdFactory(),
      now: 30,
      option: fixture.options[1],
      storyboardState: storyboardBefore,
      variantSet: fixture.variantSet,
    }, ports);

    expect({ batchesStarted, batchesEnded, batchesCanceled, verificationCalls })
      .toEqual({
        batchesStarted: 1,
        batchesEnded: 1,
        batchesCanceled: 0,
        verificationCalls: 1,
      });
    expect(result.variantSet).toMatchObject({
      status: 'committed',
      committedOptionId: 'release-option-b',
    });
    expect(result.option).toMatchObject({
      id: 'release-option-b',
      state: 'accepted',
    });
    expect(result.insertedClipIds).toHaveLength(1);
    expect(fixture.baseComposition).toEqual(baseBefore);
    expect(currentComposition.timelineData?.clips.map((clip) => clip.name))
      .toEqual([
        'release-before',
        'payload-b',
        'release-after',
      ]);
    expect(currentStoryboard.scenes['release-scene']).toMatchObject({
      status: 'filled',
      selectedCandidateId: 'candidate-option-b',
      filledClipIds: result.insertedClipIds,
    });

    const reloadedComposition = JSON.parse(
      JSON.stringify(currentComposition),
    ) as typeof currentComposition;
    const reloadedStoryboard = decodeStoryboardProjectState(JSON.parse(
      JSON.stringify(encodeStoryboardProjectState(currentStoryboard)),
    )).state;
    expect(reloadedComposition).toEqual(currentComposition);
    expect(reloadedStoryboard.variantSets[fixture.variantSet.id]).toMatchObject({
      status: 'committed',
      committedOptionId: 'release-option-b',
    });
    expect(reloadedStoryboard.variantOptions['release-option-b'].state)
      .toBe('accepted');

    expect(undoCheckpoint).toBeDefined();
    currentComposition = structuredClone(undoCheckpoint!.composition);
    currentStoryboard = structuredClone(undoCheckpoint!.storyboard);
    expect(currentComposition).toEqual(baseBefore);
    expect(currentStoryboard).toEqual(storyboardBefore);
  });
});
