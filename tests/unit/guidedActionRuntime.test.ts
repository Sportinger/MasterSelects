import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GuidedActionRuntime,
  GuidedTargetRegistry,
} from '../../src/services/guidedActions';
import { useGuidedActionStore } from '../../src/stores/guidedActionStore';
import { useTimelineStore } from '../../src/stores/timeline';
import type { GuidedAction, ToolResult } from '../../src/services/guidedActions';

const initialTimelineState = useTimelineStore.getState();

function resetGuidedActionStore(): void {
  useGuidedActionStore.setState({
    activeSession: null,
    currentStep: null,
    cursor: { visible: false, position: null, clicking: false, inputGesture: null },
    lastUserPointerPosition: null,
    spotlight: null,
    callout: null,
    highlights: [],
    previewPaths: [],
    targetResolutions: {},
    diagnostics: [],
    eventLog: [],
  });
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

describe('guided action runtime', () => {
  beforeEach(() => {
    resetGuidedActionStore();
    useTimelineStore.setState(initialTimelineState);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('cancels before the semantic execution point', async () => {
    vi.useFakeTimers();
    const registry = new GuidedTargetRegistry();
    const executeTool = vi.fn((_action: GuidedAction): ToolResult => ({ success: true }));
    const runtime = new GuidedActionRuntime({
      targetRegistry: registry,
      actionHandlers: {
        executeTool,
      },
    });

    const resultPromise = runtime.startSession({
      sessionId: 'cancel-before-tool',
      callerContext: 'chat',
      animationBudget: { totalMs: 1000, compression: 'none' },
      actions: [
        { type: 'delay', ms: 1000 },
        { type: 'executeTool', tool: 'splitClip', args: { clipId: 'clip-1', time: 1 } },
      ],
    });

    await Promise.resolve();
    runtime.cancelSession('cancel-before-tool', 'User cancelled replay');
    await vi.runAllTimersAsync();

    const result = await resultPromise;
    expect(result.status).toBe('cancelled');
    expect(result.error).toBe('User cancelled replay');
    expect(result.skippedActions).toBe(1);
    expect(executeTool).not.toHaveBeenCalled();
    expect(useGuidedActionStore.getState().activeSession?.status).toBe('cancelled');
  });

  it('records missing target diagnostics for required targets', async () => {
    const runtime = new GuidedActionRuntime({
      targetRegistry: new GuidedTargetRegistry(),
    });

    const result = await runtime.startSession({
      sessionId: 'missing-target',
      callerContext: 'chat',
      animationBudget: { totalMs: 500, compression: 'none' },
      actions: [
        { type: 'resolveTarget', target: { kind: 'dom', id: 'missing-control' }, required: true },
      ],
    });

    const state = useGuidedActionStore.getState();
    expect(result.status).toBe('failed');
    expect(result.error).toContain('No guided target resolver');
    expect(state.activeSession?.status).toBe('failed');
    expect(state.diagnostics[0]?.message).toContain('No guided target resolver');
    expect(state.targetResolutions['dom:missing-control']).toEqual(expect.objectContaining({
      status: 'missing',
      reason: 'unsupported-target-kind',
    }));
  });

  it('resolves visual targets and clears transient visuals when the session finishes', async () => {
    const target = { kind: 'dom' as const, id: 'target-panel' };
    const registry = new GuidedTargetRegistry();
    const resolver = vi.fn((requestedTarget) => {
      if (requestedTarget.kind !== 'dom' || requestedTarget.id !== target.id) {
        return null;
      }
      return {
        status: 'resolved',
        target: requestedTarget,
        rect: { x: 10, y: 20, width: 120, height: 40 },
        center: { x: 70, y: 40 },
      };
    });
    registry.registerResolver('dom', resolver, 'test-dom');
    const runtime = new GuidedActionRuntime({ targetRegistry: registry });

    const result = await runtime.startSession({
      sessionId: 'visual-target-resolution',
      callerContext: 'internal',
      animationBudget: { totalMs: 1, compression: 'none' },
      actions: [
        { type: 'highlightTarget', target, tone: 'primary' },
        { type: 'spotlight', target },
        { type: 'callout', title: 'Resolved target', target },
      ],
    });

    const state = useGuidedActionStore.getState();
    expect(result.status).toBe('completed');
    expect(resolver).toHaveBeenCalledTimes(3);
    expect(state.targetResolutions['dom:target-panel']).toEqual(expect.objectContaining({
      status: 'resolved',
      rect: { x: 10, y: 20, width: 120, height: 40 },
      center: { x: 70, y: 40 },
    }));
    expect(state.highlights).toEqual([]);
    expect(state.spotlight).toBeNull();
    expect(state.callout).toBeNull();
  });

  it('keeps the click ripple visible for the scheduled visual duration', async () => {
    vi.useFakeTimers();
    const target = { kind: 'dom' as const, id: 'click-target' };
    const registry = new GuidedTargetRegistry();
    registry.registerResolver('dom', (requestedTarget) => {
      if (requestedTarget.kind !== 'dom' || requestedTarget.id !== target.id) {
        return null;
      }
      return {
        status: 'resolved',
        target: requestedTarget,
        rect: { x: 30, y: 40, width: 80, height: 20 },
        center: { x: 70, y: 50 },
      };
    }, 'test-click-target');
    const runtime = new GuidedActionRuntime({ targetRegistry: registry });

    const resultPromise = runtime.startSession({
      sessionId: 'click-ripple-duration',
      callerContext: 'chat',
      animationBudget: { totalMs: 1000, compression: 'none' },
      actions: [
        { type: 'clickVisual', target, label: 'Click target' },
      ],
    });

    await flushMicrotasks();
    expect(useGuidedActionStore.getState().cursor).toEqual(expect.objectContaining({
      visible: true,
      position: { x: 70, y: 50 },
      clicking: true,
      inputGesture: { kind: 'mouse-left', label: 'LMB', detail: 'Click target' },
      transitionMs: 0,
    }));
    expect(useGuidedActionStore.getState().currentStep?.action.type).toBe('clickVisual');

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.status).toBe('completed');
    expect(useGuidedActionStore.getState().cursor.clicking).toBe(false);
    expect(useGuidedActionStore.getState().currentStep).toBeNull();
  });

  it('primes the next replay from the last guided cursor position and uses planned move duration', async () => {
    vi.useFakeTimers();
    const firstTarget = { kind: 'dom' as const, id: 'first-target' };
    const secondTarget = { kind: 'dom' as const, id: 'second-target' };
    const registry = new GuidedTargetRegistry();
    registry.registerResolver('dom', (requestedTarget) => {
      if (requestedTarget.kind === 'dom' && requestedTarget.id === firstTarget.id) {
        return {
          status: 'resolved',
          target: requestedTarget,
          rect: { x: 10, y: 20, width: 20, height: 20 },
          center: { x: 20, y: 30 },
        };
      }
      if (requestedTarget.kind === 'dom' && requestedTarget.id === secondTarget.id) {
        return {
          status: 'resolved',
          target: requestedTarget,
          rect: { x: 210, y: 120, width: 20, height: 20 },
          center: { x: 220, y: 130 },
        };
      }
      return null;
    }, 'test-replay-cursor-targets');
    const runtime = new GuidedActionRuntime({ targetRegistry: registry });

    const firstResultPromise = runtime.startSession({
      sessionId: 'cursor-origin-first',
      callerContext: 'chat',
      animationBudget: { totalMs: 1000, compression: 'none' },
      actions: [
        { type: 'moveCursorTo', target: firstTarget, durationMs: 600 },
      ],
    });
    await vi.runAllTimersAsync();
    await firstResultPromise;
    expect(useGuidedActionStore.getState().cursor).toEqual(expect.objectContaining({
      visible: false,
      position: { x: 20, y: 30 },
    }));

    const secondResultPromise = runtime.startSession({
      sessionId: 'cursor-origin-second',
      callerContext: 'chat',
      animationBudget: { totalMs: 1000, compression: 'none' },
      actions: [
        { type: 'moveCursorTo', target: secondTarget, durationMs: 600 },
      ],
    });

    expect(useGuidedActionStore.getState().cursor).toEqual(expect.objectContaining({
      visible: true,
      position: { x: 20, y: 30 },
      transitionMs: 0,
    }));

    await flushMicrotasks();
    expect(useGuidedActionStore.getState().cursor).toEqual(expect.objectContaining({
      visible: true,
      position: { x: 220, y: 130 },
      transitionMs: 1000,
    }));

    await vi.runAllTimersAsync();
    const secondResult = await secondResultPromise;
    expect(secondResult.status).toBe('completed');
  });

  it('prefers the last user pointer position when priming a replay cursor', async () => {
    vi.useFakeTimers();
    const target = { kind: 'dom' as const, id: 'target-from-user-pointer' };
    const registry = new GuidedTargetRegistry();
    registry.registerResolver('dom', (requestedTarget) => {
      if (requestedTarget.kind !== 'dom' || requestedTarget.id !== target.id) {
        return null;
      }
      return {
        status: 'resolved',
        target: requestedTarget,
        rect: { x: 200, y: 100, width: 40, height: 30 },
        center: { x: 220, y: 115 },
      };
    }, 'test-user-pointer-origin');
    const runtime = new GuidedActionRuntime({ targetRegistry: registry });

    useGuidedActionStore.setState({
      cursor: { visible: false, position: { x: 20, y: 30 }, clicking: false, inputGesture: null },
      lastUserPointerPosition: { x: 400, y: 250 },
    });

    const resultPromise = runtime.startSession({
      sessionId: 'cursor-origin-user-pointer',
      callerContext: 'chat',
      animationBudget: { totalMs: 1000, compression: 'none' },
      actions: [
        { type: 'moveCursorTo', target, durationMs: 600 },
      ],
    });

    expect(useGuidedActionStore.getState().cursor).toEqual(expect.objectContaining({
      visible: true,
      position: { x: 400, y: 250 },
      transitionMs: 0,
    }));

    await flushMicrotasks();
    expect(useGuidedActionStore.getState().cursor).toEqual(expect.objectContaining({
      visible: true,
      position: { x: 220, y: 115 },
      transitionMs: 1000,
    }));

    await vi.runAllTimersAsync();
    const result = await resultPromise;
    expect(result.status).toBe('completed');
  });

  it('keeps the cursor pressed while visually dragging between targets', async () => {
    vi.useFakeTimers();
    const fromTarget = { kind: 'dom' as const, id: 'drag-from' };
    const toTarget = { kind: 'dom' as const, id: 'drag-to' };
    const registry = new GuidedTargetRegistry();
    registry.registerResolver('dom', (requestedTarget) => {
      if (requestedTarget.kind === 'dom' && requestedTarget.id === fromTarget.id) {
        return {
          status: 'resolved',
          target: requestedTarget,
          rect: { x: 20, y: 30, width: 20, height: 20 },
          center: { x: 30, y: 40 },
        };
      }
      if (requestedTarget.kind === 'dom' && requestedTarget.id === toTarget.id) {
        return {
          status: 'resolved',
          target: requestedTarget,
          rect: { x: 220, y: 130, width: 20, height: 20 },
          center: { x: 230, y: 140 },
        };
      }
      return null;
    }, 'test-drag-cursor-targets');
    const runtime = new GuidedActionRuntime({ targetRegistry: registry });

    const resultPromise = runtime.startSession({
      sessionId: 'drag-cursor-pressed',
      callerContext: 'chat',
      animationBudget: { totalMs: 1000, compression: 'none' },
      actions: [
        { type: 'moveCursorTo', target: fromTarget, durationMs: 200 },
        { type: 'dragCursor', from: fromTarget, to: toTarget, durationMs: 800 },
      ],
    });

    await flushMicrotasks();
    expect(useGuidedActionStore.getState().cursor).toEqual(expect.objectContaining({
      visible: true,
      position: { x: 30, y: 40 },
      clicking: false,
    }));

    await vi.advanceTimersByTimeAsync(200);
    await flushMicrotasks();
    expect(useGuidedActionStore.getState().cursor).toEqual(expect.objectContaining({
      visible: true,
      position: { x: 230, y: 140 },
      clicking: true,
      transitionMs: 800,
    }));

    await vi.runAllTimersAsync();
    const result = await resultPromise;
    expect(result.status).toBe('completed');
    expect(useGuidedActionStore.getState().cursor.clicking).toBe(false);
  });

  it('bypasses visual actions in instant mode while still executing semantic actions', async () => {
    const registry = new GuidedTargetRegistry();
    const executed: GuidedAction[] = [];
    const runtime = new GuidedActionRuntime({
      targetRegistry: registry,
      actionHandlers: {
        executeTool: (action) => {
          executed.push(action);
          return { success: true, data: { tool: action.type === 'executeTool' ? action.tool : null } };
        },
      },
    });

    const result = await runtime.startSession({
      sessionId: 'instant-mode',
      callerContext: 'chat',
      animationBudget: 0,
      actions: [
        { type: 'moveCursorTo', target: { kind: 'dom', id: 'clip-row' }, durationMs: 500 },
        { type: 'spotlight', target: { kind: 'dom', id: 'clip-row' } },
        { type: 'executeTool', tool: 'setTransform', args: { clipId: 'clip-1', x: 240 } },
      ],
    });

    const state = useGuidedActionStore.getState();
    expect(result.status).toBe('completed');
    expect(result.diagnostics.disabled).toBe(true);
    expect(result.diagnostics.actionCount).toBe(1);
    expect(executed).toHaveLength(1);
    expect(state.activeSession?.context.visualizationMode).toBe('off');
    expect(state.cursor.visible).toBe(false);
    expect(state.spotlight).toBeNull();
  });

  it('skips AI replay visuals while still executing remaining semantic actions', async () => {
    vi.useFakeTimers();
    const executeTool = vi.fn((_action: GuidedAction): ToolResult => ({
      success: true,
      data: { executed: true },
    }));
    const runtime = new GuidedActionRuntime({
      actionHandlers: {
        executeTool,
      },
    });

    const resultPromise = runtime.startSession({
      sessionId: 'skip-ai-visuals',
      callerContext: 'chat',
      playbackMode: 'aiReplay',
      animationBudget: { totalMs: 1000, compression: 'none' },
      actions: [
        { type: 'delay', ms: 1000, label: 'Visual prelude' },
        { type: 'callout', title: 'Visual context' },
        { type: 'executeTool', tool: 'setTransform', args: { clipId: 'clip-1', x: 240 } },
        { type: 'spotlight', target: { kind: 'dom', id: 'result' } },
      ],
    });

    await Promise.resolve();
    runtime.skipSession('skip-ai-visuals', 'Skip visual replay');
    await vi.runAllTimersAsync();

    const result = await resultPromise;
    expect(result.status).toBe('skipped');
    expect(result.skippedActions).toBe(2);
    expect(executeTool).toHaveBeenCalledOnce();
    expect(result.toolResults).toEqual([
      expect.objectContaining({ success: true, data: { executed: true } }),
    ]);
    expect(useGuidedActionStore.getState().activeSession?.status).toBe('skipped');
  });

  it('uses skip as an abort for guided-user tutorial waits', async () => {
    vi.useFakeTimers();
    const runtime = new GuidedActionRuntime({
      targetRegistry: new GuidedTargetRegistry(),
    });

    const resultPromise = runtime.startSession({
      sessionId: 'skip-guided-user',
      callerContext: 'internal',
      playbackMode: 'guidedUser',
      animationBudget: { totalMs: 1000, compression: 'none' },
      inputLock: { mode: 'targetOnly', targets: [{ kind: 'panel', panel: 'timeline' }] },
      actions: [
        { type: 'waitForUserAction', check: { kind: 'clipSelected', clipId: 'clip-1' }, timeoutMs: 10000 },
      ],
    });

    await Promise.resolve();
    runtime.skipSession('skip-guided-user', 'Skip tutorial');
    await vi.runAllTimersAsync();

    const result = await resultPromise;
    expect(result.status).toBe('skipped');
    expect(result.skippedActions).toBe(1);
  });

  it('does not override the requested replay budget when the system prefers reduced motion', async () => {
    vi.useFakeTimers();
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({
        addEventListener: vi.fn(),
        addListener: vi.fn(),
        dispatchEvent: vi.fn(),
        matches: true,
        media: '(prefers-reduced-motion: reduce)',
        onchange: null,
        removeEventListener: vi.fn(),
        removeListener: vi.fn(),
      }),
    });
    const runtime = new GuidedActionRuntime({
      actionHandlers: {
        executeTool: () => ({ success: true }),
      },
    });

    try {
      const resultPromise = runtime.startSession({
        sessionId: 'reduced-motion',
        callerContext: 'chat',
        animationBudget: { totalMs: 5000, compression: 'none' },
        actions: [
          { type: 'delay', ms: 1000 },
          { type: 'executeTool', tool: 'setTransform', args: { clipId: 'clip-1', x: 240 } },
        ],
      });

      await Promise.resolve();
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.status).toBe('completed');
      expect(result.diagnostics.normalizedBudgetMs).toBe(5000);
      expect(result.diagnostics.plannedDurationMs).toBe(5000);
      expect(useGuidedActionStore.getState().activeSession?.context.animationBudget).toEqual(expect.objectContaining({
        compression: 'none',
        totalMs: 5000,
      }));
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: originalMatchMedia,
      });
    }
  });

  it('fails a session when confirmState validation does not match store state', async () => {
    const runtime = new GuidedActionRuntime({
      targetRegistry: new GuidedTargetRegistry(),
    });

    const result = await runtime.startSession({
      sessionId: 'missing-selection',
      callerContext: 'chat',
      animationBudget: 0,
      actions: [
        { type: 'confirmState', check: { kind: 'clipSelected', clipId: 'clip-1' } },
      ],
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Clip clip-1 is not selected');
    expect(useGuidedActionStore.getState().diagnostics[0]?.message).toContain('Clip clip-1 is not selected');
  });

  it('waits for user-action validation before completing', async () => {
    vi.useFakeTimers();
    const runtime = new GuidedActionRuntime({
      targetRegistry: new GuidedTargetRegistry(),
    });

    const resultPromise = runtime.startSession({
      sessionId: 'wait-for-selection',
      callerContext: 'chat',
      playbackMode: 'guidedUser',
      animationBudget: 0,
      actions: [
        { type: 'waitForUserAction', check: { kind: 'clipSelected', clipId: 'clip-1' }, timeoutMs: 1000 },
      ],
    });

    await Promise.resolve();
    useTimelineStore.setState({ selectedClipIds: new Set(['clip-1']) });
    await vi.advanceTimersByTimeAsync(100);

    const result = await resultPromise;
    expect(result.status).toBe('completed');
  });

  it('holds a tutorial step until navigation cancels or replaces it', async () => {
    const runtime = new GuidedActionRuntime({
      targetRegistry: new GuidedTargetRegistry(),
    });

    const resultPromise = runtime.startSession({
      sessionId: 'wait-for-tutorial-navigation',
      callerContext: 'internal',
      playbackMode: 'tutorialDemo',
      animationBudget: 100,
      actions: [
        { type: 'waitForTutorialNavigation' },
      ],
    });

    await flushMicrotasks();
    expect(useGuidedActionStore.getState().currentStep?.action.type).toBe('waitForTutorialNavigation');

    runtime.cancelSession('wait-for-tutorial-navigation', 'Move to another tutorial step');
    const result = await resultPromise;

    expect(result.status).toBe('cancelled');
    expect(result.error).toBe('Move to another tutorial step');
    expect(useGuidedActionStore.getState().currentStep).toBeNull();
  });
});
