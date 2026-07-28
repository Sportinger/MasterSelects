import type {
  AgentTimelineAnalysisEstimate,
  AgentTimelineAnalysisScopeKind,
} from '../../../types/agentTimeline/analysisEstimate';
import type { AgentTimelineProfile, AgentTimelineRange } from '../../../types/agentTimeline/manifest';
import {
  localVisualProfileIsSupported,
  type CurrentClipLocalVisualOptions,
} from '../../../services/agentTimeline/jobs/currentClipAnalysisExecution';
import type { AnalysisActionConfiguration } from './AnalysisActionCenter';

type LocalScope = Extract<AgentTimelineAnalysisScopeKind, 'source' | 'used-ranges' | 'selection' | 'in-out'>;

export const ANALYSIS_SCOPE_KINDS: readonly LocalScope[] = [
  'source',
  'used-ranges',
  'selection',
  'in-out',
];

export type AnalysisScopeRanges = Record<LocalScope, readonly AgentTimelineRange[] | undefined>;

export function resolveLocalVisualExecution(
  scope: LocalScope,
  profile: AgentTimelineProfile,
  scopeRanges: AnalysisScopeRanges,
): { localVisual?: CurrentClipLocalVisualOptions; blockedReason?: string } {
  const sourceRanges = scopeRanges[scope];
  if (!sourceRanges || !localVisualProfileIsSupported(profile)) {
    return {
      blockedReason: !localVisualProfileIsSupported(profile)
        ? `${profile[0].toUpperCase() + profile.slice(1)} is blocked until matching real-media benchmark evidence is available.`
        : 'Choose an available source range before starting local visual analysis.',
    };
  }
  return {
    localVisual: {
      profile,
      sourceRange: sourceRanges[0],
      // SFace identities are intentionally limited to a clip range. A full
      // source pass would produce an incompatible second identity set.
      includeFaces: scope !== 'source',
    },
  };
}

interface CreateAnalysisActionConfigurationInput {
  scope: LocalScope;
  profile: AgentTimelineProfile;
  scopeRanges: AnalysisScopeRanges;
  estimate?: AgentTimelineAnalysisEstimate;
  isSelected: boolean;
  hasInOutRange: boolean;
  blockedReason?: string;
  onScopeChange: (scope: LocalScope) => void;
  onProfileChange: (profile: AgentTimelineProfile) => void;
}

export function createAnalysisActionConfiguration(
  input: CreateAnalysisActionConfigurationInput,
): AnalysisActionConfiguration {
  const executionNote = input.blockedReason
    ? `Blocked: ${input.blockedReason}`
    : `${input.scope === 'source'
      ? 'Focus & Motion uses the full source at the selected cadence. Faces are unavailable for source scope because identity grouping remains clip-range scoped.'
      : 'Focus & Motion and Faces receive this exact source range and selected cadence.'} Scene Cuts always remain a frame-accurate 160×90 source scan. Transcript and AI Scenes keep their existing provider semantics.`;
  return {
    scope: input.scope,
    profile: input.profile,
    scopes: ANALYSIS_SCOPE_KINDS.map((id) => ({
      id,
      label: id === 'source' ? 'Source'
        : id === 'used-ranges' ? 'Used Ranges'
          : id === 'selection' ? 'Selection'
            : 'In-Out',
      disabled: !input.scopeRanges[id],
      disabledReason: id === 'selection' && !input.isSelected
        ? 'Select this clip to estimate the current selection.'
        : id === 'in-out' && !input.hasInOutRange
          ? 'Set an In and Out range that overlaps this clip.'
          : undefined,
    })),
    estimate: input.estimate,
    estimateUnavailableReason: input.scope === 'selection' && !input.isSelected
      ? 'Select this clip to preview selection work.'
      : input.scope === 'in-out' && !input.hasInOutRange
        ? 'Set an In and Out range that overlaps this clip.'
        : 'This source does not expose a usable duration yet.',
    executionNote,
    onScopeChange: input.onScopeChange,
    onProfileChange: input.onProfileChange,
  };
}
