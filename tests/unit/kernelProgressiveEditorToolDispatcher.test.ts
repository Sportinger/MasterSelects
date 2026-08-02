import { describe, expect, it, vi } from 'vitest';

import {
  createWp1EditorOperationAuthorization,
  createWp1EditorOperationDispatcher,
} from '../../src/services/kernelClient/wp1Spike/editorOperationDispatcher';
import type { AcceptedKernelOperationPlanV1 } from '../../src/services/kernelClient/wp1Spike/operationSessionAuthority';

const mutatingBatch = {
  requestJson: JSON.stringify({
    requests: [
      { args: { text: 'Hello' }, toolName: 'createTextClip' },
      { args: { clipId: 'text-1', color: '#ffffff' }, toolName: 'updateTextProperties' },
    ],
  }),
};

describe('progressive kernel editor-tool dispatcher', () => {
  it('executes one kernel-owned batch through the existing grouped tool executor', async () => {
    const execute = vi.fn(async (calls) => calls.map((call: { tool: string }) => ({
      result: { data: { toolName: call.tool }, success: true },
      tool: call.tool,
    })));
    const dispatch = createWp1EditorOperationDispatcher(execute);

    const result = await dispatch('timeline.editor.mutate.v1', mutatingBatch);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).toHaveLength(2);
    expect(execute.mock.calls[0]?.[1]).toBe('kernel');
    expect(execute.mock.calls[0]?.[2]).toEqual({
      guidedReplay: false,
      suppressHistory: false,
    });
    expect(result).toMatchObject({
      data: {
        results: [
          { toolName: 'createTextClip' },
          { toolName: 'updateTextProperties' },
        ],
      },
      success: true,
    });
  });

  it('binds the wrapper operation risk to every locally known inner tool', () => {
    const acceptedPlan = {
      permits: vi.fn(() => true),
    } as unknown as AcceptedKernelOperationPlanV1;
    const authorize = createWp1EditorOperationAuthorization(acceptedPlan);

    expect(authorize('timeline.editor.mutate.v1', mutatingBatch)).toBe(true);
    expect(authorize('timeline.editor.inspect.v1', mutatingBatch)).toBe(false);
    expect(authorize('timeline.editor.mutate.v1', {
      requestJson: JSON.stringify({
        requests: [{ args: {}, toolName: 'manageEditableHook' }],
      }),
    })).toBe(false);
  });
});
