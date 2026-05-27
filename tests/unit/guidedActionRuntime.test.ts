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
    expect(result.skippedActions).toBe(2);
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

  it('resolves visual targets before rendering highlight, spotlight, and callout state', async () => {
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
    expect(state.highlights[0]).toEqual(expect.objectContaining({ target }));
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

  it('caps planned animation when the system prefers reduced motion', async () => {
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
      expect(result.diagnostics.normalizedBudgetMs).toBe(250);
      expect(result.diagnostics.plannedDurationMs).toBeLessThanOrEqual(250);
      expect(useGuidedActionStore.getState().activeSession?.context.animationBudget).toEqual(expect.objectContaining({
        compression: 'aggressive',
        totalMs: 250,
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
});
