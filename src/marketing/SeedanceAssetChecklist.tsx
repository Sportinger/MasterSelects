import { useEffect, useState } from 'react';

import type {
  CommonsSourceAsset,
  SeedanceAssetPlan,
  SeedanceAssetSourceKind,
  SeedancePreproductionRun,
  SeedanceResearchDiagnostic,
  SeedanceResearchRequirement,
  SeedanceStory,
  SeedanceStoryScene,
} from '../services/seedancePreproduction/contracts';
import { researchRequirementsForRun } from '../services/seedancePreproduction/assetPlan';

type AssetCategory =
  | 'commons-reference'
  | 'project-source'
  | 'practical-footage'
  | 'generated-image'
  | 'motion-graphic'
  | 'reconstruction'
  | 'designed-visual';

interface VisualNeed {
  categories: AssetCategory[];
  description: string;
  cameraDirection?: string;
  id?: string;
  priority?: 'required' | 'supporting';
  sourceKind?: SeedanceAssetSourceKind;
}

interface AssetChecklistItem {
  categories: AssetCategory[];
  requirements: SeedanceResearchRequirement[];
  scene: SeedanceStoryScene;
  visualNeeds: VisualNeed[];
}

interface RequirementResearchState {
  assets: CommonsSourceAsset[];
  diagnostic?: SeedanceResearchDiagnostic;
  requirement: SeedanceResearchRequirement;
}

interface SceneProductionRow {
  research: RequirementResearchState[];
  visualNeed: VisualNeed;
  voiceover: string;
}

const CATEGORY_LABELS: Record<AssetCategory, string> = {
  'commons-reference': 'Commons reference',
  'project-source': 'Project source',
  'practical-footage': 'Practical footage',
  'generated-image': 'Generated image',
  'motion-graphic': 'Motion graphic',
  reconstruction: 'Reconstruction',
  'designed-visual': 'Designed visual',
};

const SOURCE_CATEGORY: Record<SeedanceAssetSourceKind, AssetCategory> = {
  commons: 'commons-reference',
  'project-source': 'project-source',
  'practical-footage': 'practical-footage',
  'generated-image': 'generated-image',
  'motion-graphic': 'motion-graphic',
  reconstruction: 'reconstruction',
  'designed-visual': 'designed-visual',
};

const SOURCE_EXPLANATIONS: Record<Exclude<SeedanceAssetSourceKind, 'commons'>, string> = {
  'project-source': 'Use the material already stored with this project.',
  'practical-footage': 'Capture this as original production footage.',
  'generated-image': 'Create this as a clearly synthetic visual anchor.',
  'motion-graphic': 'Build this as an animated explanatory element.',
  reconstruction: 'Stage this as an explicitly labelled reconstruction.',
  'designed-visual': 'Design this for the film instead of presenting it as archival evidence.',
};

const CATEGORY_PATTERNS: Array<[AssetCategory, RegExp]> = [
  ['practical-footage', /aufnahme|außenblick|camera|exterior|filmmaterial|footage|kassenzettel|küchentisch|macro|receipt|table|werkstatt|workshop|werkzeug|tool/iu],
  ['motion-graphic', /aktenmontage|balken|chart|diagram|grafik|graph|karte|map|split-screen|tafel|timeline|typograf|zeitleiste/iu],
  ['reconstruction', /inszeniert|reconstruction|rekonstruktion|stilisiert|staged/iu],
  ['designed-visual', /akte|akten|gesetzblatt|invoice|rechnung|stempel|document|dokument/iu],
];

const RESEARCH_STOP_WORDS = new Set([
  'abbildung', 'aufnahme', 'bild', 'commons', 'eine', 'einen', 'einer', 'eines',
  'image', 'oder', 'photo', 'scene', 'soll', 'the', 'this', 'wikimedia', 'wurde',
  'würde', 'zeigen', 'zur',
]);

function categoriesForText(value: string): AssetCategory[] {
  const categories = CATEGORY_PATTERNS.flatMap(([category, pattern]) => (
    pattern.test(value) ? [category] : []
  ));
  return categories.length > 0 ? categories : ['designed-visual'];
}

function splitProductionText(value: string): string[] {
  return (value.match(/[^.!?\n]+(?:[.!?]+|$)/gu) ?? [])
    .map((part) => part.trim())
    .filter(Boolean);
}

function researchTokens(value: string): Set<string> {
  return new Set((value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [])
    .filter((token) => token.length >= 4 && !RESEARCH_STOP_WORDS.has(token)));
}

function researchMatchScore(state: RequirementResearchState, need: VisualNeed): number {
  const research = researchTokens(`${state.requirement.query} ${state.requirement.purpose}`);
  const visual = researchTokens(need.description);
  return [...research].filter((token) => [...visual].some((candidate) => (
    candidate === token
    || (candidate.length >= 6 && token.length >= 6 && (
      candidate.startsWith(token) || token.startsWith(candidate)
    ))
  ))).length;
}

function plannedVisualNeeds(
  scene: SeedanceStoryScene,
  assetPlan?: SeedanceAssetPlan,
): VisualNeed[] {
  const needs = assetPlan?.assetNeeds.filter((need) => need.sceneId === scene.id) ?? [];
  if (needs.length === 0) return buildSceneVisualNeeds(scene);
  return needs.map((need) => ({
    id: need.id,
    categories: [SOURCE_CATEGORY[need.sourceKind]],
    description: need.description,
    cameraDirection: need.cameraDirection,
    priority: need.priority,
    sourceKind: need.sourceKind,
  }));
}

function buildSceneVisualNeeds(scene: SeedanceStoryScene): VisualNeed[] {
  return scene.visualIntent
    .split(/(?:[.!?]+\s+|;\s+)/u)
    .map((description) => description.trim().replace(/[.!?]+$/u, ''))
    .filter(Boolean)
    .map((description) => ({ description, categories: categoriesForText(description) }));
}

function categoriesForScene(
  scene: SeedanceStoryScene,
  requirements: SeedanceResearchRequirement[],
): AssetCategory[] {
  const categories: AssetCategory[] = requirements.length > 0 ? ['commons-reference'] : [];
  for (const category of categoriesForText(scene.visualIntent)) {
    if (!categories.includes(category)) categories.push(category);
  }
  return categories;
}

function buildSeedanceAssetChecklist(
  story: SeedanceStory,
  assetPlan?: SeedanceAssetPlan,
  plannedRequirements: SeedanceResearchRequirement[] = story.researchRequirements,
): AssetChecklistItem[] {
  return story.scenes.map((scene) => {
    const requirements = plannedRequirements.filter((requirement) => (
      requirement.sceneId === scene.id
    ));
    const visualNeeds = plannedVisualNeeds(scene, assetPlan);
    return {
      scene,
      requirements,
      categories: assetPlan
        ? [...new Set(visualNeeds.flatMap((need) => need.categories))]
        : categoriesForScene(scene, requirements),
      visualNeeds,
    };
  });
}

function researchStateForRequirement(
  run: SeedancePreproductionRun,
  requirement: SeedanceResearchRequirement,
): RequirementResearchState {
  return {
    requirement,
    diagnostic: run.researchDiagnostics.find((item) => item.requirementId === requirement.id),
    assets: run.sourceAssets.filter((asset) => asset.requirementId === requirement.id),
  };
}

function buildSceneProductionRows(
  scene: SeedanceStoryScene,
  visualNeeds: VisualNeed[],
  research: RequirementResearchState[],
): { rows: SceneProductionRow[]; unmatchedResearch: RequirementResearchState[] } {
  const needs = visualNeeds.length > 0
    ? visualNeeds
    : [{ categories: categoriesForText(scene.visualIntent), description: scene.visualIntent }];
  const voiceoverParts = splitProductionText(scene.narration);
  const researchByNeed = needs.map((): RequirementResearchState[] => []);
  const unmatchedResearch: RequirementResearchState[] = [];

  for (const state of research) {
    if (state.requirement.assetNeedId) {
      const plannedIndex = needs.findIndex((need) => need.id === state.requirement.assetNeedId);
      if (plannedIndex >= 0) {
        researchByNeed[plannedIndex]?.push(state);
        continue;
      }
    }
    const scores = needs.map((need) => researchMatchScore(state, need));
    const bestScore = Math.max(...scores);
    if (bestScore === 0) {
      unmatchedResearch.push(state);
      continue;
    }
    researchByNeed[scores.indexOf(bestScore)]?.push(state);
  }

  const voiceoverByNeed = needs.map((): string[] => []);
  voiceoverParts.forEach((part, index) => {
    const target = voiceoverParts.length <= needs.length
      ? index
      : Math.min(needs.length - 1, Math.floor(index * needs.length / voiceoverParts.length));
    voiceoverByNeed[target]?.push(part);
  });

  return {
    unmatchedResearch,
    rows: needs.map((visualNeed, index) => ({
      visualNeed,
      research: researchByNeed[index] ?? [],
      voiceover: voiceoverByNeed[index]?.join(' ') ?? '',
    })),
  };
}

function researchStatusLabel(state: RequirementResearchState): string {
  if (state.assets.length > 0) {
    return `${state.assets.length} ${state.assets.length === 1 ? 'reference' : 'references'} found`;
  }
  if (state.diagnostic?.status === 'empty') return 'Needed · not found on Commons';
  if (state.diagnostic?.status === 'failed') return 'Needed · Commons search failed';
  return 'Commons search pending';
}

function SceneCommons({
  states,
  visualNeed,
}: {
  states: RequirementResearchState[];
  visualNeed?: VisualNeed;
}) {
  if (states.length === 0) {
    const sourceKind = visualNeed?.sourceKind;
    if (sourceKind && sourceKind !== 'commons') {
      return (
        <div className="seedance-commons-unplanned is-routed">
          <strong>{CATEGORY_LABELS[SOURCE_CATEGORY[sourceKind]]} planned</strong>
          <span>{SOURCE_EXPLANATIONS[sourceKind]} This is not a missing Commons result.</span>
        </div>
      );
    }
    return (
      <div className="seedance-commons-unplanned">
        <strong>No Commons search planned</strong>
        <span>This visual still needs a production source or an explicit archive search.</span>
      </div>
    );
  }
  return (
    <div className="seedance-scene-research">
      <strong className="seedance-scene-subheading">Commons / archive</strong>
      <ul>
        {states.map((state) => {
          const status = state.assets.length > 0 ? 'matched' : state.diagnostic?.status ?? 'pending';
          return (
            <li className={`is-${status}`} key={state.requirement.id}>
              <div className="seedance-research-need-heading">
                <strong>{researchStatusLabel(state)}</strong>
                <span>{state.requirement.purpose}</span>
              </div>
              {state.assets.length > 0 ? (
                <div className="seedance-scene-reference-grid">
                  {state.assets.map((asset) => (
                    <a href={asset.sourceUrl} key={asset.id} rel="noreferrer" target="_blank">
                      <img alt={asset.title} decoding="async" draggable={false} loading="lazy" src={asset.thumbnailUrl} />
                      <span><strong>{asset.title}</strong><small>{asset.license}{asset.selected ? ' · selected' : ' · excluded'}</small></span>
                    </a>
                  ))}
                </div>
              ) : (
                <code>{state.requirement.query}</code>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SceneSequence({
  run,
  scene,
  visualNeeds,
  requirements,
}: {
  requirements: SeedanceResearchRequirement[];
  run: SeedancePreproductionRun;
  scene: SeedanceStoryScene;
  visualNeeds: VisualNeed[];
}) {
  const research = requirements.map((requirement) => researchStateForRequirement(run, requirement));
  const { rows, unmatchedResearch } = buildSceneProductionRows(scene, visualNeeds, research);
  return (
    <ol className="seedance-scene-sequence">
      {rows.map((row, index) => (
        <li className="seedance-scene-beat" key={`${scene.id}-beat-${index}`}>
          <section className="seedance-scene-voice">
            <strong>Voiceover {String(index + 1).padStart(2, '0')}</strong>
            {row.voiceover
              ? <p>{row.voiceover}</p>
              : <span>Visual continuation · no new spoken line</span>}
          </section>
          <section className="seedance-scene-visual">
            <div className="seedance-scene-visual-heading">
              <strong>Camera &amp; visual direction</strong>
              <span>{row.visualNeed.priority ? `${row.visualNeed.priority} · ` : ''}{row.visualNeed.categories.map((category) => CATEGORY_LABELS[category]).join(' + ')}</span>
            </div>
            <p>{row.visualNeed.description}</p>
            {row.visualNeed.cameraDirection && (
              <p className="seedance-camera-direction"><strong>Camera</strong>{row.visualNeed.cameraDirection}</p>
            )}
            <SceneCommons states={row.research} visualNeed={row.visualNeed} />
          </section>
        </li>
      ))}
      {unmatchedResearch.length > 0 && (
        <li className="seedance-scene-beat is-scene-evidence">
          <section className="seedance-scene-voice">
            <strong>Scene-level evidence</strong>
            <span>These factual anchors support the scene as a whole.</span>
          </section>
          <section className="seedance-scene-visual">
            <SceneCommons states={unmatchedResearch} />
          </section>
        </li>
      )}
    </ol>
  );
}

function SceneAgentTrace({ run, sceneId }: { run: SeedancePreproductionRun; sceneId: string }) {
  const plan = (run.scenePlans ?? []).find((candidate) => candidate.sceneId === sceneId);
  const agent = run.orchestration?.agents.toReversed().find((candidate) => candidate.sceneId === sceneId);
  const binding = run.orchestration?.treatment?.sceneBindings.find((candidate) => candidate.sceneId === sceneId);
  const world = binding
    ? run.orchestration?.treatment?.visualWorlds.find((candidate) => candidate.id === binding.visualWorldId)
    : undefined;
  return (
    <section className="seedance-scene-agent-trace" aria-live="polite">
      <header>
        <div><small>Scene agent</small><strong>{agent?.status ?? (plan ? 'closed' : 'queued')}</strong></div>
        {world && <span>{world.title}</span>}
      </header>
      {binding && (
        <dl>
          <div><dt>Visual state</dt><dd>{binding.visualState}</dd></div>
          <div><dt>Continuity in</dt><dd>{binding.transitionIn}</dd></div>
          <div><dt>Continuity out</dt><dd>{binding.transitionOut}</dd></div>
        </dl>
      )}
      {plan ? (
        <div className="seedance-scene-agent-result">
          <strong>{plan.sourceRoute.replaceAll('-', ' ')}</strong>
          <p>{plan.visualProposal}</p>
          <p><b>Source plan</b>{plan.sourcePlan}</p>
          {plan.visualWorldChangeRequest && <p><b>World change request</b>{plan.visualWorldChangeRequest}</p>}
          {plan.risks.length > 0 && <ul>{plan.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul>}
        </div>
      ) : (
        <p className="seedance-scene-agent-waiting">Open scene details stay attached to the live journal. Closing this box does not stop the worker.</p>
      )}
    </section>
  );
}

export function SeedanceAssetChecklist({
  onSceneExpandedChange,
  run,
}: {
  onSceneExpandedChange?: (sceneId: string, expanded: boolean) => void;
  run: SeedancePreproductionRun;
}) {
  const firstSceneId = run.story?.scenes[0]?.id;
  const [expandedSceneIds, setExpandedSceneIds] = useState<Set<string>>(() => (
    new Set(firstSceneId ? [firstSceneId] : [])
  ));
  useEffect(() => {
    if (!firstSceneId) return;
    onSceneExpandedChange?.(firstSceneId, true);
    return () => onSceneExpandedChange?.(firstSceneId, false);
  }, [firstSceneId, onSceneExpandedChange]);
  if (!run.story) return null;
  const requirements = researchRequirementsForRun(run);
  const items = buildSeedanceAssetChecklist(run.story, run.assetPlan, requirements);
  const diagnosticsByRequirement = new Map(run.researchDiagnostics.map((diagnostic) => (
    [diagnostic.requirementId, diagnostic]
  )));
  const gaps = requirements.filter((requirement) => (
    !run.sourceAssets.some((asset) => asset.requirementId === requirement.id)
    && ['empty', 'failed'].includes(diagnosticsByRequirement.get(requirement.id)?.status ?? '')
  )).length;
  const pendingSearches = requirements.filter((requirement) => (
    !diagnosticsByRequirement.has(requirement.id)
  )).length;
  const visualBeatCount = items.reduce((total, item) => total + item.visualNeeds.length, 0);
  const setSceneExpanded = (sceneId: string, expanded: boolean) => {
    onSceneExpandedChange?.(sceneId, expanded);
    setExpandedSceneIds((current) => {
      const next = new Set(current);
      if (expanded) next.add(sceneId);
      else next.delete(sceneId);
      return next;
    });
  };
  return (
    <section className="seedance-asset-checklist" aria-label="Production asset checklist">
      <header>
        <div><small>Scene production map</small><strong>Voice, camera and source coverage</strong></div>
        <span>{items.length} scenes · {visualBeatCount} asset needs · {requirements.length} Commons searches · {run.sourceAssets.length} images · {gaps} search gaps{pendingSearches > 0 ? ` · ${pendingSearches} pending` : ''}</span>
      </header>
      <ol>
        {items.map(({ categories, requirements, scene, visualNeeds }, index) => (
          <li key={scene.id}>
            <details
              className="seedance-scene-disclosure"
              open={expandedSceneIds.has(scene.id)}
              onToggle={(event) => setSceneExpanded(scene.id, event.currentTarget.open)}
            >
              <summary>
                <div className="seedance-asset-title">
                  <span className="seedance-asset-number">{String(index + 1).padStart(2, '0')}</span>
                  <strong>{scene.title}</strong>
                  <span>{Math.round(scene.durationSeconds)}s</span>
                </div>
                <div className="seedance-asset-tags">
                  {categories.map((category) => (
                    <span className={`is-${category}`} key={category}>{CATEGORY_LABELS[category]}</span>
                  ))}
                </div>
                <span className="seedance-scene-toggle" aria-hidden="true" />
              </summary>
              {expandedSceneIds.has(scene.id) && (
                <div className="seedance-scene-expanded-content">
                  <SceneAgentTrace run={run} sceneId={scene.id} />
                  <SceneSequence
                    requirements={requirements}
                    run={run}
                    scene={scene}
                    visualNeeds={visualNeeds}
                  />
                </div>
              )}
            </details>
          </li>
        ))}
      </ol>
    </section>
  );
}
