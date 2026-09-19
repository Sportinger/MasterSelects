import type { ToolResult } from '../aiTools';

const DIRECT_CODEX_PREVIEW_TIMEOUT_MS = 30_000;

export function directCodexToolFailure(toolName: string, error: unknown): ToolResult {
  const detail = error instanceof Error && error.message.trim()
    ? error.message.trim()
    : 'The editor tool failed unexpectedly.';
  return {
    success: false,
    error: `${toolName} could not complete: ${detail}`,
    data: {
      guidance: 'Continue the conversation, explain the limitation, and use another available approach when possible.',
      toolName,
    },
  };
}

export async function runDirectCodexToolWithRecovery(
  toolName: string,
  execute: (signal: AbortSignal) => Promise<ToolResult>,
  parentSignal?: AbortSignal,
  timeoutMs = toolName === 'getMediaPreviewFrames' ? DIRECT_CODEX_PREVIEW_TIMEOUT_MS : 0,
): Promise<ToolResult> {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true });

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const execution = execute(controller.signal).catch(
      error => directCodexToolFailure(toolName, error),
    );
    if (timeoutMs <= 0) return await execution;
    const timeout = new Promise<ToolResult>((resolve) => {
      timeoutId = setTimeout(() => {
        const error = new Error(`Timed out after ${Math.ceil(timeoutMs / 1_000)} seconds.`);
        controller.abort(error);
        resolve(directCodexToolFailure(toolName, error));
      }, timeoutMs);
    });
    return await Promise.race([execution, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}
