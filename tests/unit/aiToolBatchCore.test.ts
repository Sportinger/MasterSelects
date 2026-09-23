import { describe, expect, it, vi } from 'vitest';
import { executeBatchCore } from '../../src/services/aiTools/handlers/batch';
import type { BatchToolExecutor } from '../../src/services/aiTools/handlers/batch';

const focusNodeGraph = vi.hoisted(() => vi.fn(async () => ({ success: true })));
vi.mock('../../src/services/aiTools/handlers/focusNodeGraph', () => ({ handleFocusNodeGraph: focusNodeGraph }));

describe('AI tool batch core', () => {
  it('shows the target node graph before the next batch action', async () => {
    focusNodeGraph.mockClear();
    const executeTool = vi.fn<BatchToolExecutor>(async (tool) => {
      if (tool === 'setTransform') expect(focusNodeGraph).toHaveBeenCalledWith({ clipId: 'clip-1' });
      return { success: true };
    });
    await executeBatchCore({ actions: [
      { tool: 'editOperatorGraph', args: { clipId: 'clip-1', effectId: 'effect-1', action: 'set' } },
      { tool: 'setTransform', args: { clipId: 'clip-1', x: 120 } },
    ] }, { callerContext: 'internal', executeTool, staggerBudgetMs: 0 });
    expect(focusNodeGraph).toHaveBeenCalledTimes(1);
  });
  it('waits for each presentation frame before applying the next action', async () => {
    let release!: () => void;
    const presented = new Promise<void>(resolve => { release = resolve; });
    const executeTool = vi.fn<BatchToolExecutor>(async () => ({ success: true }));
    const run = executeBatchCore({ actions: [
      { tool: 'splitClip', args: { clipId: 'clip-1', splitTime: 4 } },
      { tool: 'setTransform', args: { clipId: 'clip-1', x: 120 } },
    ] }, { callerContext: 'internal', executeTool, staggerBudgetMs: 0,
      onBatchAction: ({ index }) => index === 1 ? presented : undefined });
    await vi.waitFor(() => expect(executeTool).toHaveBeenCalledTimes(1));
    release();
    await run;
    expect(executeTool).toHaveBeenCalledTimes(2);
  });
  it('executes normalized batch actions with before/after hooks', async () => {
    const executeTool = vi.fn<BatchToolExecutor>(async (tool, args) => ({
      success: true,
      data: { args, tool },
    }));
    const beforeAction = vi.fn();
    const afterAction = vi.fn();
    const onBatchAction = vi.fn();

    const result = await executeBatchCore({
      actions: [
        { tool: 'splitClip', args: { clipId: 'clip-1', splitTime: 4 } },
        { tool: 'setTransform', clipId: 'clip-1', x: 120 },
      ],
    }, {
      callerContext: 'internal',
      executeTool,
      hooks: { beforeAction, afterAction },
      onBatchAction,
      staggerBudgetMs: 0,
    });

    expect(result.success).toBe(true);
    expect(executeTool).toHaveBeenNthCalledWith(1, 'splitClip', { clipId: 'clip-1', splitTime: 4 }, 'internal');
    expect(executeTool).toHaveBeenNthCalledWith(2, 'setTransform', { clipId: 'clip-1', x: 120 }, 'internal');
    expect(beforeAction).toHaveBeenCalledTimes(2);
    expect(afterAction).toHaveBeenCalledTimes(2);
    expect(onBatchAction).toHaveBeenNthCalledWith(1, { index: 1, total: 2, tool: 'splitClip', success: true });
    expect(onBatchAction).toHaveBeenNthCalledWith(2, { index: 2, total: 2, tool: 'setTransform', success: true });
    expect(beforeAction).toHaveBeenNthCalledWith(2, expect.objectContaining({
      args: { clipId: 'clip-1', x: 120 },
      index: 1,
      tool: 'setTransform',
    }));
  });

  it('returns a complete cancellation result when aborted between actions', async () => {
    const controller = new AbortController();
    const executeTool = vi.fn<BatchToolExecutor>(async (tool) => ({
      success: true,
      data: { tool },
    }));

    const result = await executeBatchCore({
      actions: [
        { tool: 'splitClip', args: { clipId: 'clip-1', splitTime: 4 } },
        { tool: 'setTransform', args: { clipId: 'clip-1', x: 120 } },
      ],
    }, {
      callerContext: 'internal',
      executeTool,
      hooks: {
        afterAction: () => controller.abort(),
      },
      signal: controller.signal,
      staggerBudgetMs: 0,
    });
    const data = result.data as {
      cancelled: boolean;
      failed: number;
      results: Array<{ error?: string; success: boolean; tool: string }>;
      succeeded: number;
      totalActions: number;
    };

    expect(result.success).toBe(false);
    expect(result.error).toBe('Batch execution cancelled');
    expect(data.cancelled).toBe(true);
    expect(data.totalActions).toBe(2);
    expect(data.succeeded).toBe(1);
    expect(data.failed).toBe(1);
    expect(data.results).toEqual([
      expect.objectContaining({ success: true, tool: 'splitClip' }),
      expect.objectContaining({ success: false, tool: 'setTransform', error: 'Batch execution cancelled' }),
    ]);
    expect(executeTool).toHaveBeenCalledTimes(1);
  });

  it('resolves earlier action result values inside later arguments', async () => {
    const executeTool = vi.fn<BatchToolExecutor>(async (tool, args) => ({
      success: true,
      data: tool === 'createMotionShapeClip'
        ? {
            clipId: 'motion-created',
            primaryAppearanceIds: { fill: 'fill-created' },
          }
        : { tool, args },
    }));

    const result = await executeBatchCore({
      actions: [
        {
          tool: 'createMotionShapeClip',
          args: { primitive: 'rectangle' },
        },
        {
          tool: 'updateMotionProperties',
          args: {
            clipId: { $batchResult: { action: 0, path: 'clipId' } },
            updates: [{
              path: {
                $batchResult: {
                  action: 0,
                  path: 'primaryAppearanceIds.fill',
                },
              },
              value: 0.5,
            }],
          },
        },
      ],
    }, {
      callerContext: 'internal',
      executeTool,
      staggerBudgetMs: 0,
    });

    expect(result.success).toBe(true);
    expect(executeTool).toHaveBeenNthCalledWith(2, 'updateMotionProperties', {
      clipId: 'motion-created',
      updates: [{ path: 'fill-created', value: 0.5 }],
    }, 'internal');
  });

  it('rejects missing and forward batch result references without invoking the action', async () => {
    const executeTool = vi.fn<BatchToolExecutor>(async () => ({
      success: true,
      data: { clipId: 'created' },
    }));

    const result = await executeBatchCore({
      actions: [
        {
          tool: 'createMotionShapeClip',
          args: {
            trackId: { $batchResult: { action: 1, path: 'trackId' } },
          },
        },
        {
          tool: 'setTransform',
          args: {
            clipId: { $batchResult: { action: 0, path: 'missing' } },
          },
        },
      ],
    }, {
      callerContext: 'internal',
      executeTool,
      staggerBudgetMs: 0,
    });
    const data = result.data as {
      failed: number;
      results: Array<{ error?: string }>;
    };

    expect(result.success).toBe(false);
    expect(data.failed).toBe(2);
    expect(data.results[0]?.error).toContain('earlier action');
    expect(data.results[1]?.error).toContain('did not succeed');
    expect(executeTool).not.toHaveBeenCalled();
  });
});
