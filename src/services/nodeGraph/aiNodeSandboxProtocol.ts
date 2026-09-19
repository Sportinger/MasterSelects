import type { AINodeRuntimeTexture } from './aiNodeRuntime';
import type {
  AINodeRuntimeContext,
  AINodeRuntimeInputValue,
} from './aiNodeRuntimeGraphSignals';

export const AI_NODE_SANDBOX_EXECUTION_TIMEOUT_MS = 150;
export const AI_NODE_SANDBOX_INIT_TIMEOUT_MS = 1_000;

export interface AINodeSandboxCode {
  id: string;
  code: string;
}

export interface AINodeSandboxNodeRequest {
  id: string;
  kind: 'generated' | 'pixel-sort';
  context: AINodeRuntimeContext;
  connectedInputs: Record<string, AINodeRuntimeInputValue>;
}

export interface AINodeSandboxInitRequest {
  type: 'init';
  nodes: AINodeSandboxCode[];
}

export interface AINodeSandboxRunRequest {
  type: 'run';
  requestId: number;
  texture: AINodeRuntimeTexture;
  nodes: AINodeSandboxNodeRequest[];
}

export type AINodeSandboxRequest = AINodeSandboxInitRequest | AINodeSandboxRunRequest;

export interface AINodeSandboxReadyResponse {
  type: 'ready';
}

export interface AINodeSandboxResultResponse {
  type: 'result';
  requestId: number;
  texture: AINodeRuntimeTexture;
}

export interface AINodeSandboxErrorResponse {
  type: 'error';
  requestId?: number;
  error: string;
}

export type AINodeSandboxResponse =
  | AINodeSandboxReadyResponse
  | AINodeSandboxResultResponse
  | AINodeSandboxErrorResponse;
