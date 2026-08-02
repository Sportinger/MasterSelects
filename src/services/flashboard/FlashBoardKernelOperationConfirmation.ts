import type { KernelOperationConfirmationRequestV1 } from '../kernelClient/wp1Spike/operationRoundTrip';
import type { FlashBoardChatRequest } from './FlashBoardChatTypes';

/**
 * Resolves the editor-side gate without falling back to a blocking native
 * browser dialog. Submitting a normal Execute turn is the user's authorization
 * for its bound operation plan; Plan and Read-only turns remain fail-closed.
 * Embedders can still provide a stricter in-app confirmation callback.
 */
export async function approveFlashBoardKernelOperation(
  request: Pick<
    FlashBoardChatRequest,
    'onKernelOperationConfirmation' | 'toolExecutionMode'
  >,
  confirmation: Readonly<KernelOperationConfirmationRequestV1>,
): Promise<boolean> {
  if (request.onKernelOperationConfirmation) {
    return request.onKernelOperationConfirmation(confirmation);
  }
  return request.toolExecutionMode === undefined || request.toolExecutionMode === 'normal';
}
