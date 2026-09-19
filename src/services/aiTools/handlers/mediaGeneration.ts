import {
  getAgentMediaGenerationStatus,
  inspectAgentMediaGenerationModel,
  previewAgentMediaGeneration,
  startAgentMediaGeneration,
  type AgentMediaGenerationRequestInput,
  type AgentMediaGenerationSelection,
  type AgentMediaGenerationStatusInput,
} from '../../flashboard/FlashBoardAgentGeneration';
import type { ToolResult } from '../types';

function parseRequestJson(args: Record<string, unknown>): Record<string, unknown> {
  if (typeof args.requestJson !== 'string') throw new Error('requestJson is required.');
  const parsed = JSON.parse(args.requestJson) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('requestJson must contain an object.');
  }
  return parsed as Record<string, unknown>;
}

async function resultOf(work: () => unknown | Promise<unknown>): Promise<ToolResult> {
  try {
    return { success: true, data: await work() };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Media generation request failed.',
    };
  }
}

export async function handleInspectMediaGenerationModel(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  return resultOf(() => inspectAgentMediaGenerationModel(
    parseRequestJson(args) as unknown as AgentMediaGenerationSelection,
  ));
}

export async function handlePreviewMediaGeneration(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  return resultOf(() => previewAgentMediaGeneration(
    parseRequestJson(args) as unknown as AgentMediaGenerationRequestInput,
  ));
}

export async function handleStartMediaGeneration(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  return resultOf(() => startAgentMediaGeneration(
    parseRequestJson(args) as unknown as AgentMediaGenerationRequestInput,
  ));
}

export async function handleGetMediaGenerationStatus(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  return resultOf(() => getAgentMediaGenerationStatus(
    parseRequestJson(args) as unknown as AgentMediaGenerationStatusInput,
  ));
}
