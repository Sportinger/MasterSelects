import { afterEach, beforeEach, describe, expect, it, type Mock } from 'vitest';
import { flags } from '../../src/engine/featureFlags';
import { createGuidedReplayBudgetController, executeAITool, executeAIToolCalls } from '../../src/services/aiTools';
import { useGuidedActionStore } from '../../src/stores/guidedActionStore';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useSettingsStore } from '../../src/stores/settingsStore';
import { DEFAULT_TRANSFORM, useTimelineStore } from '../../src/stores/timeline';
import type { TimelineClip } from '../../src/types';

const initialTimelineState = useTimelineStore.getState();
const initialMediaState = useMediaStore.getState();

describe('guided AI tool integration', () => {
  beforeEach(() => {
    flags.guidedActionsRuntime = false;
    flags.guidedActionsAIReplay = false;
    resetGuidedActionStore();
    resetGuidedReplaySettings();
    useTimelineStore.setState(initialTimelineState);
    useMediaStore.setState(initialMediaState);
  });

  afterEach(() => {
    flags.guidedActionsRuntime = false;
    flags.guidedActionsAIReplay = false;
    resetGuidedActionStore();
    resetGuidedReplaySettings();
  });

  it('routes chat tools through guided runtime when replay flags are enabled', async () => {
    flags.guidedActionsRuntime = true;
    flags.guidedActionsAIReplay = true;
    const clip = createClip();
    useTimelineStore.setState({ clips: [clip] });

    const result = await executeAITool('setTransform', {
      clipId: clip.id,
      x: 192,
    }, 'chat', {
      guidedAnimationBudgetMs: 0,
    });

    const updated = useTimelineStore.getState().clips.find((entry) => entry.id === clip.id);
    const guidedSession = useGuidedActionStore.getState().activeSession;

    expect(result.success).toBe(true);
    expect(result.data).toEqual(expect.objectContaining({ clipId: clip.id }));
    expect(updated?.transform.position.x).toBe(0.1);
    expect(guidedSession).toEqual(expect.objectContaining({
      label: 'AI: setTransform',
      status: 'completed',
    }));
    expect(guidedSession?.context.animationBudget.disabled).toBe(true);
    expect(guidedSession?.metadata?.toolName).toBe('setTransform');
  });

  it('uses guided replay settings as the chat default', async () => {
    flags.guidedActionsRuntime = true;
    flags.guidedActionsAIReplay = true;
    resetGuidedReplaySettings({
      guidedActionReplayVisualizationMode: 'full',
      guidedActionReplayBudgetMs: 0,
      guidedActionReplayCompressionMode: 'aggressive',
    });
    const clip = createClip();
    useTimelineStore.setState({ clips: [clip] });

    const result = await executeAITool('setTransform', {
      clipId: clip.id,
      scaleX: 120,
    }, 'chat');

    const guidedSession = useGuidedActionStore.getState().activeSession;

    expect(result.success).toBe(true);
    expect(guidedSession?.context.visualizationMode).toBe('off');
    expect(guidedSession?.context.animationBudget).toEqual(expect.objectContaining({
      compression: 'aggressive',
      disabled: true,
      totalMs: 0,
    }));
  });

  it('spends one shared replay budget across multiple guided tool calls', async () => {
    flags.guidedActionsRuntime = true;
    flags.guidedActionsAIReplay = true;
    const budgetController = createGuidedReplayBudgetController({
      totalMs: 100,
      compression: 'none',
    });
    const clip = createClip();
    useTimelineStore.setState({ clips: [clip] });

    await executeAITool('setTransform', {
      clipId: clip.id,
      x: 192,
    }, 'chat', {
      guidedReplayBudgetController: budgetController,
      guidedReplayRemainingCalls: 2,
    });
    const firstPlan = useGuidedActionStore.getState().activeSession?.plan.diagnostics.plannedDurationMs ?? 0;
    const remainingAfterFirst = budgetController.getRemainingBudgetMs();

    await executeAITool('setTransform', {
      clipId: clip.id,
      y: -108,
    }, 'chat', {
      guidedReplayBudgetController: budgetController,
      guidedReplayRemainingCalls: 1,
    });
    const secondPlan = useGuidedActionStore.getState().activeSession?.plan.diagnostics.plannedDurationMs ?? 0;

    expect(firstPlan).toBeGreaterThan(0);
    expect(firstPlan).toBeLessThanOrEqual(50);
    expect(remainingAfterFirst).toBeGreaterThan(0);
    expect(firstPlan + secondPlan).toBeLessThanOrEqual(100);
    expect(budgetController.getRemainingBudgetMs()).toBeGreaterThanOrEqual(0);
  });

  it('runs multiple chat tool calls in a single guided session', async () => {
    flags.guidedActionsRuntime = true;
    flags.guidedActionsAIReplay = true;
    const clip = createClip();
    useTimelineStore.setState({ clips: [clip] });

    const results = await executeAIToolCalls([
      {
        id: 'call-x',
        tool: 'setTransform',
        args: { clipId: clip.id, x: 192 },
      },
      {
        id: 'call-y',
        tool: 'setTransform',
        args: { clipId: clip.id, y: -108 },
      },
    ], 'chat', {
      guidedAnimationBudgetMs: 0,
    });

    const updated = useTimelineStore.getState().clips.find((entry) => entry.id === clip.id);
    const state = useGuidedActionStore.getState();
    const sessionStarts = state.eventLog.filter((event) => event.type === 'session-started');

    expect(results).toEqual([
      expect.objectContaining({ id: 'call-x', result: expect.objectContaining({ success: true }) }),
      expect.objectContaining({ id: 'call-y', result: expect.objectContaining({ success: true }) }),
    ]);
    expect(updated?.transform.position.x).toBe(0.1);
    expect(updated?.transform.position.y).toBe(-0.1);
    expect(sessionStarts).toHaveLength(1);
    expect(state.activeSession).toEqual(expect.objectContaining({
      label: 'AI: setTransform x2',
      status: 'completed',
    }));
    expect(state.activeSession?.metadata?.toolNames).toEqual(['setTransform', 'setTransform']);
  });

  it('keeps devBridge on the direct execution path by default', async () => {
    flags.guidedActionsRuntime = true;
    flags.guidedActionsAIReplay = true;
    const clip = createClip();
    useTimelineStore.setState({ clips: [clip] });

    const result = await executeAITool('setTransform', {
      clipId: clip.id,
      y: -108,
    }, 'devBridge', {
      guidedAnimationBudgetMs: 0,
    });

    const updated = useTimelineStore.getState().clips.find((entry) => entry.id === clip.id);

    expect(result.success).toBe(true);
    expect(updated?.transform.position.y).toBe(-0.1);
    expect(useGuidedActionStore.getState().activeSession).toBeNull();
  });

  it('allows devBridge to opt into guided replay explicitly without chat rollout flags', async () => {
    const clip = createClip();
    useTimelineStore.setState({ clips: [clip] });

    const result = await executeAITool('setTransform', {
      clipId: clip.id,
      x: 192,
    }, 'devBridge', {
      guidedReplay: true,
      guidedAnimationBudgetMs: 0,
    });

    const updated = useTimelineStore.getState().clips.find((entry) => entry.id === clip.id);
    const guidedSession = useGuidedActionStore.getState().activeSession;

    expect(result.success).toBe(true);
    expect(updated?.transform.position.x).toBe(0.1);
    expect(guidedSession).toEqual(expect.objectContaining({
      label: 'AI: setTransform',
      status: 'completed',
    }));
  });

  it('suppresses legacy AI feedback while guided replay owns chat visualization', async () => {
    flags.guidedActionsRuntime = true;
    flags.guidedActionsAIReplay = true;
    const clip = createClip();
    useTimelineStore.setState({ clips: [clip], aiActionOverlays: [] });

    const result = await executeAITool('splitClip', {
      clipId: clip.id,
      splitTime: 2,
      withLinked: false,
    }, 'chat', {
      guidedAnimationBudgetMs: 0,
    });

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().aiActionOverlays).toHaveLength(0);
    expect(useGuidedActionStore.getState().activeSession).toEqual(expect.objectContaining({
      label: 'AI: splitClip',
      status: 'completed',
    }));
  });
});

function createClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'clip-1',
    trackId: 'video-1',
    name: 'Clip',
    file: new File([], 'clip.mp4'),
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: { type: 'video' },
    transform: structuredClone(DEFAULT_TRANSFORM),
    effects: [],
    ...overrides,
  };
}

interface MockGuidedReplaySettings {
  outputResolution: { width: number; height: number };
  guidedActionReplayVisualizationMode: 'off' | 'concise' | 'full';
  guidedActionReplayBudgetMs: number;
  guidedActionReplayCompressionMode: 'none' | 'family' | 'aggressive';
}

function resetGuidedReplaySettings(overrides: Partial<MockGuidedReplaySettings> = {}): void {
  (useSettingsStore.getState as unknown as Mock).mockReturnValue({
    outputResolution: { width: 1920, height: 1080 },
    guidedActionReplayVisualizationMode: 'concise',
    guidedActionReplayBudgetMs: 3000,
    guidedActionReplayCompressionMode: 'family',
    ...overrides,
  });
}

function resetGuidedActionStore(): void {
  useGuidedActionStore.setState({
    activeSession: null,
    currentStep: null,
    cursor: { visible: false, position: null, clicking: false },
    spotlight: null,
    callout: null,
    highlights: [],
    previewPaths: [],
    targetResolutions: {},
    diagnostics: [],
    eventLog: [],
  });
}
