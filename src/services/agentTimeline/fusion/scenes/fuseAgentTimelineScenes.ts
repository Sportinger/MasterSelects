import type {
  SceneFusionInput,
  SceneFusionResult,
} from '../../../../types/agentTimeline/sceneFusion';
import { buildRuleBasedSceneBlocks } from './sceneBlockFusion';
import { buildConservativeSceneCandidates } from './sceneCandidateFusion';

export function fuseAgentTimelineScenes(input: SceneFusionInput): SceneFusionResult {
  const scenes = buildRuleBasedSceneBlocks(input);
  const status = scenes.covered.length === 0
    ? 'missing'
    : scenes.missing.length === 0 ? 'complete' : 'partial';
  return {
    policy: scenes.policy,
    range: { ...input.range },
    coverage: {
      status,
      covered: scenes.covered,
      missing: scenes.missing,
    },
    sceneEvents: scenes.sceneEvents,
    candidateGroups: buildConservativeSceneCandidates(input, scenes.sceneEvents, scenes.policy),
    unknowns: scenes.unknowns.toSorted((left, right) => left.code.localeCompare(right.code)),
  };
}

