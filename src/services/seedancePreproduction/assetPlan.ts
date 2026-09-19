import type {
  SeedanceAssetPlan,
  SeedancePreproductionRun,
  SeedanceResearchRequirement,
} from './contracts';

export function researchRequirementsFromAssetPlan(
  assetPlan: SeedanceAssetPlan,
): SeedanceResearchRequirement[] {
  return assetPlan.assetNeeds.flatMap((need, index) => {
    const [query, ...alternativeQueries] = need.commonsQueries;
    if (!query) return [];
    return [{
      id: `asset-plan-${String(index + 1).padStart(3, '0')}`,
      query,
      purpose: need.description,
      sceneId: need.sceneId,
      assetNeedId: need.id,
      alternativeQueries,
    }];
  });
}

export function researchRequirementsForRun(
  run: Pick<SeedancePreproductionRun, 'assetPlan' | 'story'>,
): SeedanceResearchRequirement[] {
  if (run.assetPlan) return researchRequirementsFromAssetPlan(run.assetPlan);
  return run.story?.researchRequirements ?? [];
}
