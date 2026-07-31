import { describe, expect, it, vi } from 'vitest';
import { checkToolAccess } from '../../src/services/aiTools/policy';
import { executeBatchCore } from '../../src/services/aiTools/handlers/batch';
import { buildFlashBoardChatIntentPrompt } from '../../src/components/panels/flashboard/FlashBoardChatSendPlanner';
import { executeFlashBoardToolCalls } from '../../src/services/flashboard/FlashBoardChatTools';

describe('Storyboard Plan-mode tool boundary', () => {
  it('makes Plan and decision policy explicit in the model-facing prompt', () => {
    const prompt = buildFlashBoardChatIntentPrompt(
      'Make a three-scene opening.',
      'plan',
      'milestones',
    );
    expect(prompt).toContain('[DIRECTING MODE: PLAN]');
    expect(prompt).toMatch(/Do not mutate real media/i);
    expect(prompt).toMatch(/milestones/i);
    expect(prompt).toContain('Make a three-scene opening.');
  });

  it('allows timeline reads but rejects real-media mutation', () => {
    expect(checkToolAccess('getTimelineState', 'chat', {
      executionMode: 'plan',
    })).toEqual({ allowed: true });
    expect(checkToolAccess('deleteClip', 'chat', {
      executionMode: 'plan',
    })).toMatchObject({
      allowed: false,
      reason: expect.stringMatching(/Plan mode/i),
    });
    expect(checkToolAccess('downloadAndImportVideo', 'chat', {
      executionMode: 'plan',
    }).allowed).toBe(false);
  });

  it('keeps normal execute behavior unchanged', () => {
    expect(checkToolAccess('deleteClip', 'chat').allowed).toBe(true);
    expect(checkToolAccess('deleteClip', 'chat', {
      executionMode: 'normal',
    }).allowed).toBe(true);
  });

  it('rejects real-media mutation through the direct provider tool bridge', async () => {
    const [executed] = await executeFlashBoardToolCalls([{
      id: 'plan-delete',
      name: 'deleteClip',
      arguments: JSON.stringify({ clipId: 'clip-that-must-not-change' }),
    }], Number.POSITIVE_INFINITY, {
      toolExecutionMode: 'plan',
    });

    expect(executed?.result).toMatchObject({
      success: false,
      error: expect.stringMatching(/Plan mode/i),
    });
  });

  it('rejects a mixed batch before executing any nested action', async () => {
    const executeTool = vi.fn(async () => ({ success: true }));
    const result = await executeBatchCore({
      actions: [
        { tool: 'getTimelineState', args: {} },
        { tool: 'deleteClip', args: { clipId: 'clip-1' } },
      ],
    }, {
      callerContext: 'chat',
      executeTool,
      executionMode: 'plan',
    });

    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/deleteClip.*Plan mode/i),
    });
    expect(executeTool).not.toHaveBeenCalled();
  });

  it('enforces read-only mode through the same shared policy', () => {
    expect(checkToolAccess('trimClip', 'chat', {
      executionMode: 'read-only',
    })).toMatchObject({
      allowed: false,
      reason: expect.stringMatching(/read-only/i),
    });
  });
});
