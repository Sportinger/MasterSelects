import type { FlashBoardChatAgentMode } from './FlashBoardChatTypes';

/**
 * Model behind the Direct path. Both profiles share the Direct prompt, tools,
 * thread handling, and browser tool execution; only the app-server model differs.
 * The kernel relay pins the allowed provider/model pairs.
 */
export type DirectModelProfileId = 'codex' | 'deepseek';

export interface DirectModelProfile {
  /**
   * Deferred tools rely on the provider's hosted tool search. Providers without
   * it would never see the editor tools, so they receive every tool up front.
   */
  deferToolLoading: boolean;
  effort: 'high' | 'xhigh';
  label: string;
  model: string;
  /** App-server provider id; omitted for the subscription-backed default provider. */
  modelProvider?: 'deepseek';
  serviceTier?: 'fast';
  /** Prefix that keeps each profile's stored threads apart. */
  threadNamespace: string;
}

const DIRECT_MODEL_PROFILES: Record<DirectModelProfileId, DirectModelProfile> = {
  codex: {
    deferToolLoading: true,
    effort: 'xhigh',
    label: 'Codex Direct',
    model: 'gpt-5.6-sol',
    serviceTier: 'fast',
    threadNamespace: '',
  },
  deepseek: {
    deferToolLoading: false,
    // DeepSeek-V4.1-Flash supports low/high/max; high is its default.
    effort: 'high',
    label: 'DeepSeek',
    model: 'deepseek-flash',
    modelProvider: 'deepseek',
    threadNamespace: 'deepseek:',
  },
};

export const DIRECT_MODEL_PROFILE_IDS = Object.keys(DIRECT_MODEL_PROFILES) as DirectModelProfileId[];

export function isDirectModelProfileId(value: unknown): value is DirectModelProfileId {
  return value === 'codex' || value === 'deepseek';
}

export function resolveDirectModelProfile(id?: DirectModelProfileId): DirectModelProfile {
  return DIRECT_MODEL_PROFILES[id ?? 'codex'];
}

/** Fast runs the Direct workflow on DeepSeek; Logic stays on the kernel path. */
export function directModelProfileForAgentMode(
  mode: FlashBoardChatAgentMode | undefined,
): DirectModelProfileId | null {
  if (mode === 'direct') return 'codex';
  if (mode === 'standard' || mode === undefined) return 'deepseek';
  return null;
}

export function isDirectChatAgentMode(mode: FlashBoardChatAgentMode | undefined): boolean {
  return directModelProfileForAgentMode(mode) !== null;
}
