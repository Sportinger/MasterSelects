import { describe, expect, it, vi } from 'vitest';

import { approveFlashBoardKernelOperation } from '../../src/services/flashboard/FlashBoardKernelOperationConfirmation';
import type { KernelOperationConfirmationRequestV1 } from '../../src/services/kernelClient/wp1Spike/operationRoundTrip';

const confirmation = {
  batchId: 'batch-1',
  kind: 'kernel-operation-confirmation-request',
  planBinding: '{"plan":"bound"}',
  requiredOperations: [{
    operationId: 'timeline.segment.delete-many.v1',
    sequence: 2,
  }],
  schemaVersion: 1,
  sequence: 1,
  sessionId: 'session-1',
  turnId: 'turn-1',
} as const satisfies KernelOperationConfirmationRequestV1;

describe('FlashBoard kernel operation confirmation policy', () => {
  it('approves explicit Execute turns without a blocking browser confirmation', async () => {
    await expect(approveFlashBoardKernelOperation({}, confirmation)).resolves.toBe(true);
    await expect(approveFlashBoardKernelOperation({
      toolExecutionMode: 'normal',
    }, confirmation)).resolves.toBe(true);
  });

  it('keeps Plan and Read-only turns fail-closed', async () => {
    await expect(approveFlashBoardKernelOperation({
      toolExecutionMode: 'plan',
    }, confirmation)).resolves.toBe(false);
    await expect(approveFlashBoardKernelOperation({
      toolExecutionMode: 'read-only',
    }, confirmation)).resolves.toBe(false);
  });

  it('honors an explicit in-app confirmation callback', async () => {
    const onKernelOperationConfirmation = vi.fn(async () => false);
    await expect(approveFlashBoardKernelOperation({
      onKernelOperationConfirmation,
      toolExecutionMode: 'normal',
    }, confirmation)).resolves.toBe(false);
    expect(onKernelOperationConfirmation).toHaveBeenCalledWith(confirmation);
  });
});
