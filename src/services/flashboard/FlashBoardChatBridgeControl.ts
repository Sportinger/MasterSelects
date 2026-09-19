import { runFlashBoardBridgeChatTurn } from './FlashBoardChatBridgeRunner';
import type { FlashBoardChatAgentMode, FlashBoardChatModelClass } from './FlashBoardChatTypes';

export interface FlashBoardBridgeChatRequest {
  preproductionRunId?: string;
  prompt: string;
  requestedAgentMode?: Extract<FlashBoardChatAgentMode, 'logic'>;
  requestedModelClass?: FlashBoardChatModelClass;
}

export interface FlashBoardBridgeChatResult {
  assistantMessageId?: string;
  error?: string;
  kernelOutcome?: string;
  status: 'completed' | 'stopped' | 'rejected';
  success: boolean;
}

export interface FlashBoardBridgeChatModelClassResult {
  modelClass?: FlashBoardChatModelClass;
  error?: string;
  success: boolean;
}

export interface FlashBoardBridgeChatResetResult {
  error?: string;
  success: boolean;
}

type FlashBoardBridgeChatHandler = (
  request: FlashBoardBridgeChatRequest,
) => Promise<FlashBoardBridgeChatResult>;

type FlashBoardBridgeChatModelClassHandler = (
  modelClass: FlashBoardChatModelClass,
) => Promise<FlashBoardBridgeChatModelClassResult>;

type FlashBoardBridgeChatResetHandler = () => Promise<FlashBoardBridgeChatResetResult>;

let activeHandler: FlashBoardBridgeChatHandler | null = null;
let activeModelClassHandler: FlashBoardBridgeChatModelClassHandler | null = null;
let activeResetHandler: FlashBoardBridgeChatResetHandler | null = null;
let activeFallbackAbortController: AbortController | null = null;
let visibleModelClass: FlashBoardChatModelClass | null = null;

const BRIDGE_CHAT_CONTROL_MOUNT_TIMEOUT_MS = 10_000;

export function reportFlashBoardBridgeChatModelClass(
  modelClass: FlashBoardChatModelClass,
): void {
  visibleModelClass = modelClass;
}

export function getFlashBoardBridgeChatModelClass(): FlashBoardChatModelClass | null {
  return visibleModelClass;
}

export function hasFlashBoardBridgeChatHandler(): boolean {
  return activeHandler !== null;
}

async function waitForBridgeChatControls(): Promise<void> {
  if (activeHandler && activeModelClassHandler) return;
  const deadline = Date.now() + BRIDGE_CHAT_CONTROL_MOUNT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    if (activeHandler && activeModelClassHandler) return;
  }
}

export function registerFlashBoardBridgeChatHandler(
  handler: FlashBoardBridgeChatHandler,
): () => void {
  activeHandler = handler;
  return () => {
    if (activeHandler === handler) {
      activeHandler = null;
    }
  };
}

export function registerFlashBoardBridgeChatModelClassHandler(
  handler: FlashBoardBridgeChatModelClassHandler,
): () => void {
  activeModelClassHandler = handler;
  return () => {
    if (activeModelClassHandler === handler) {
      activeModelClassHandler = null;
    }
  };
}

export function registerFlashBoardBridgeChatResetHandler(
  handler: FlashBoardBridgeChatResetHandler,
): () => void {
  activeResetHandler = handler;
  return () => {
    if (activeResetHandler === handler) {
      activeResetHandler = null;
    }
  };
}

export async function resetFlashBoardBridgeChat(): Promise<FlashBoardBridgeChatResetResult> {
  const deadline = Date.now() + BRIDGE_CHAT_CONTROL_MOUNT_TIMEOUT_MS;
  while (!activeResetHandler && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  if (!activeResetHandler) {
    return {
      error: 'The visible FlashBoard chat controls are not mounted in this browser session.',
      success: false,
    };
  }
  return activeResetHandler();
}

export async function setFlashBoardBridgeChatModelClass(
  modelClass: FlashBoardChatModelClass,
): Promise<FlashBoardBridgeChatModelClassResult> {
  await waitForBridgeChatControls();
  if (!activeModelClassHandler) {
    return {
      error: 'The visible FlashBoard chat controls are not mounted in this browser session.',
      success: false,
    };
  }

  return activeModelClassHandler(modelClass);
}

export async function sendFlashBoardBridgeChatMessage(
  request: FlashBoardBridgeChatRequest,
): Promise<FlashBoardBridgeChatResult> {
  const prompt = request.prompt.trim();
  if (!prompt) {
    return {
      error: 'The chat prompt must not be empty.',
      status: 'rejected',
      success: false,
    };
  }

  await waitForBridgeChatControls();
  if (activeHandler) {
    return activeHandler({
      prompt,
      ...(request.preproductionRunId === undefined
        ? {}
        : { preproductionRunId: request.preproductionRunId }),
      ...(request.requestedAgentMode === undefined
        ? {}
        : { requestedAgentMode: request.requestedAgentMode }),
      ...(request.requestedModelClass === undefined
        ? {}
        : { requestedModelClass: request.requestedModelClass }),
    });
  }

  if (activeFallbackAbortController) {
    return {
      error: 'A bridge chat turn is already running in this browser session.',
      status: 'rejected',
      success: false,
    };
  }

  const abortController = new AbortController();
  activeFallbackAbortController = abortController;
  try {
    const result = await runFlashBoardBridgeChatTurn({
      decisionPolicy: 'automatic',
      persistToChat: true,
      ...(request.preproductionRunId === undefined
        ? {}
        : { preproductionRunId: request.preproductionRunId }),
      prompt,
      ...(request.requestedAgentMode === undefined
        ? {}
        : { requestedAgentMode: request.requestedAgentMode }),
      requestedModelClass: request.requestedModelClass ?? 'fast',
      runSource: 'bridge',
      signal: abortController.signal,
      toolExecutionMode: 'normal',
    });
    return {
      ...(result.assistantMessageId === undefined
        ? {}
        : { assistantMessageId: result.assistantMessageId }),
      ...(result.kernelReport?.outcome === undefined
        ? {}
        : { kernelOutcome: result.kernelReport.outcome }),
      status: 'completed',
      success: true,
    };
  } catch (error) {
    const stopped = abortController.signal.aborted;
    return {
      error: stopped
        ? 'Chat stopped.'
        : error instanceof Error ? error.message : 'Chat request failed.',
      status: stopped ? 'stopped' : 'rejected',
      success: false,
    };
  } finally {
    if (activeFallbackAbortController === abortController) {
      activeFallbackAbortController = null;
    }
  }
}

export function cancelFlashBoardBridgeChatMessage(): boolean {
  if (!activeFallbackAbortController) return false;
  activeFallbackAbortController.abort();
  activeFallbackAbortController = null;
  return true;
}
