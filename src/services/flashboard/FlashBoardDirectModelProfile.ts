import type { FlashBoardChatAgentMode } from './FlashBoardChatTypes';

/**
 * Model behind the Direct path. All profiles share the Direct prompt, tools,
 * thread handling, and browser tool execution; only the app-server model differs.
 * The kernel relay pins the allowed provider/model pairs.
 */
export type DirectModelProfileId = 'codex' | 'terra' | 'deepseek';

export interface DirectModelProfile {
  /**
   * Deferred tools rely on the provider's hosted tool search. Providers without
   * it would never see the editor tools, so they receive every tool up front.
   */
  deferToolLoading: boolean;
  effort: 'medium' | 'high' | 'xhigh';
  label: string;
  model: string;
  /** App-server provider id; omitted for the subscription-backed default provider. */
  modelProvider?: 'deepseek';
  serviceTier?: 'fast';
  /** Prefix that keeps each profile's stored threads apart. */
  threadNamespace: string;
}

const DIRECT_MODEL_PROFILES: Record<DirectModelProfileId, DirectModelProfile> = {
  // Slow: the strongest Codex model with high reasoning, standard processing.
  codex: {
    deferToolLoading: true,
    effort: 'high',
    label: 'Slow',
    model: 'gpt-5.6-sol',
    threadNamespace: '',
  },
  // Medium: Terra with medium reasoning on the priority ("fast") service tier.
  terra: {
    deferToolLoading: true,
    effort: 'medium',
    label: 'Medium',
    model: 'gpt-5.6-terra',
    serviceTier: 'fast',
    threadNamespace: 'terra:',
  },
  deepseek: {
    deferToolLoading: false,
    // DeepSeek-V4.1-Flash supports low/high/max; high is its default.
    effort: 'high',
    label: 'Fast',
    model: 'deepseek-flash',
    modelProvider: 'deepseek',
    threadNamespace: 'deepseek:',
  },
};

export const DIRECT_MODEL_PROFILE_IDS = Object.keys(DIRECT_MODEL_PROFILES) as DirectModelProfileId[];

export function isDirectModelProfileId(value: unknown): value is DirectModelProfileId {
  return value === 'codex' || value === 'terra' || value === 'deepseek';
}

export function resolveDirectModelProfile(id?: DirectModelProfileId): DirectModelProfile {
  return DIRECT_MODEL_PROFILES[id ?? 'codex'];
}

/** Fast, Medium and Slow run the same Direct workflow on different models; Logic stays on the kernel path. */
export function directModelProfileForAgentMode(
  mode: FlashBoardChatAgentMode | undefined,
): DirectModelProfileId | null {
  if (mode === 'direct') return 'codex';
  if (mode === 'direct-medium') return 'terra';
  if (mode === 'standard' || mode === undefined) return 'deepseek';
  return null;
}

export function isDirectChatAgentMode(mode: FlashBoardChatAgentMode | undefined): boolean {
  return directModelProfileForAgentMode(mode) !== null;
}
