import type { SeedanceStory } from './contracts';

export type SeedanceDirectionCountPreference = 'auto' | 'one' | 'five';
export type SeedanceBinaryPreference = 'auto' | 'enabled' | 'disabled';
export type SeedanceScenePlanningPreference = 'auto' | 'root' | 'agents';

export interface SeedanceStoryPreferences {
  directionCount: SeedanceDirectionCountPreference;
  aiGeneration: SeedanceBinaryPreference;
  commons: SeedanceBinaryPreference;
  scenePlanning: SeedanceScenePlanningPreference;
}

export const DEFAULT_SEEDANCE_STORY_PREFERENCES: SeedanceStoryPreferences = {
  directionCount: 'auto',
  aiGeneration: 'auto',
  commons: 'auto',
  scenePlanning: 'auto',
};

export type SeedanceOrchestrationPhase =
  | 'initializing'
  | 'ideating'
  | 'reviewing'
  | 'synthesizing'
  | 'awaiting-selection'
  | 'writing-story'
  | 'planning-scenes'
  | 'reviewing-media'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface VisualStoryConcept {
  schemaVersion: 1;
  id: string;
  title: string;
  deliverableFormat?: string;
  visualSummary?: string[];
  visualDramaturgy?: string[];
  premise: string;
  summary: string;
  visualCohesion: string;
  productionApproach: string;
  strongestOpportunity: string;
  largestRisk: string;
  targetDurationSeconds?: number;
}

export interface VisualStoryConceptReview {
  schemaVersion: 1;
  id: string;
  conceptId: string;
  recommendation: 'keep' | 'revise' | 'replace';
  summary: string;
  scores: Record<ReviewScoreName, number>;
  strengths: string[];
  weaknesses: string[];
  requiredImprovements: string[];
  optionalImprovements: string[];
  alternative?: VisualStoryConcept;
  duplicateOfConceptId?: string;
}

export type ReviewScoreName =
  | 'dramaturgy'
  | 'cohesion'
  | 'continuityPotential'
  | 'sourceFit'
  | 'evidenceSafety'
  | 'productionFeasibility'
  | 'modelFeasibility'
  | 'differentiation'
  | 'costEfficiency'
  | 'consistencyPotential';

export interface FinalVisualStoryConcept extends VisualStoryConcept {
  rank: number;
  lineage: {
    originalConceptId: string;
    reviewId?: string;
    source: 'original' | 'review-alternative' | 'orchestrator-revision';
  };
  changeSummary: string;
}

export interface SeedanceVisualWorld {
  schemaVersion: 1;
  id: string;
  title: string;
  narrativePurpose: string;
  visualRules: string[];
  paletteAndLight: string;
  recurringElements: string[];
  continuityRules: string[];
  referenceStrategy: string;
  requiresNewReferences: boolean;
  plannedReferenceCount: number;
}

export interface SeedanceVisualTreatment {
  schemaVersion: 1;
  kind: 'visual-treatment';
  conceptId: string;
  visualThesis: string;
  recurringThroughline: string;
  sourceStrategy: string;
  graphicsPolicy: string;
  generationPolicy: string;
  sourceReview?: {
    required: boolean;
    reason: string;
  };
  aiGeneration?: {
    required: boolean;
    reason: string;
  };
  scenePlanning?: {
    mode: 'root-only' | 'scene-agents';
    reason: string;
    rootScenePlans: SeedanceScenePlan[];
  };
  visualWorlds: SeedanceVisualWorld[];
  sceneBindings: Array<{
    schemaVersion: 1;
    sceneId: string;
    visualWorldId: string;
    visualState: string;
    transitionIn: string;
    transitionOut: string;
  }>;
}

export interface SeedanceScenePlan {
  schemaVersion: 1;
  sceneId: string;
  revision: number;
  dramaturgicalFunction: string;
  visualProposal: string;
  continuityIn: string;
  continuityOut: string;
  visualWorldId: string;
  visualWorldChangeRequest?: string;
  sourceRoute: 'commons' | 'project-source' | 'practical-footage' | 'generated-image'
    | 'motion-graphic' | 'reconstruction' | 'designed-visual';
  sourcePlan: string;
  commonsQueries: string[];
  cameraDirection: string;
  promptDraft?: string;
  risks: string[];
  status: 'draft' | 'reviewed' | 'accepted';
}

export interface SeedanceAgentRecord {
  schemaVersion: 1;
  id: string;
  role: 'orchestrator' | 'ideator' | 'concept-reviewer' | 'story-planner'
    | 'scene-planner' | 'prompt-planner' | 'visual-reviewer';
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'closed';
  conceptId?: string;
  sceneId?: string;
  startedAt?: number;
  completedAt?: number;
  closedAt?: number;
  error?: string;
}

export interface SeedanceOrchestrationPublicRun {
  schemaVersion: 1;
  kind: 'seedance-orchestration-run';
  runId: string;
  prompt: string;
  sourceBundleId: string;
  snapshotFingerprint: string;
  preferences: SeedanceStoryPreferences;
  phase: SeedanceOrchestrationPhase;
  createdAt: number;
  updatedAt: number;
  nextSequence: number;
  drafts: VisualStoryConcept[];
  reviews: VisualStoryConceptReview[];
  finalConcepts: FinalVisualStoryConcept[];
  selectedConceptId?: string;
  story?: SeedanceStory;
  treatment?: SeedanceVisualTreatment;
  scenePlanCount: number;
  agents: SeedanceAgentRecord[];
  error?: string;
}

interface EventEnvelope<K extends string, P> {
  schemaVersion: 1;
  eventId: string;
  runId: string;
  sequence: number;
  createdAt: number;
  kind: K;
  payload: P;
  agentId?: string;
  conceptId?: string;
  sceneId?: string;
}

export type SeedanceOrchestrationEvent =
  | EventEnvelope<'run.started' | 'run.phase', { phase: SeedanceOrchestrationPhase }>
  | EventEnvelope<'root.ready', { resumed: boolean }>
  | EventEnvelope<'agent.status', SeedanceAgentRecord>
  | EventEnvelope<'concept.draft', VisualStoryConcept>
  | EventEnvelope<'concepts.reset' | 'finals.reset', { reason: string }>
  | EventEnvelope<'review.completed', VisualStoryConceptReview>
  | EventEnvelope<'orchestrator.status', {
      status: 'considering' | 'revising' | 'replacing' | 'ordering';
      message: string;
    }>
  | EventEnvelope<'concept.final', FinalVisualStoryConcept>
  | EventEnvelope<'concepts.finalized', { orderedConceptIds: string[] }>
  | EventEnvelope<'selection.accepted', { selectedConceptId: string }>
  | EventEnvelope<'story.completed', SeedanceStory>
  | EventEnvelope<'treatment.completed', SeedanceVisualTreatment>
  | EventEnvelope<'scene.plan', SeedanceScenePlan>
  | EventEnvelope<'run.failed', { error: string }>
  | EventEnvelope<'run.cancelled', { reason: string }>;

const PHASES = new Set<SeedanceOrchestrationPhase>([
  'initializing', 'ideating', 'reviewing', 'synthesizing', 'awaiting-selection',
  'writing-story', 'planning-scenes', 'reviewing-media', 'completed', 'failed', 'cancelled',
]);
const AGENT_ROLES = new Set<SeedanceAgentRecord['role']>([
  'orchestrator', 'ideator', 'concept-reviewer', 'story-planner', 'scene-planner',
  'prompt-planner', 'visual-reviewer',
]);
const AGENT_STATUSES = new Set<SeedanceAgentRecord['status']>([
  'queued', 'running', 'succeeded', 'failed', 'closed',
]);
const SOURCE_ROUTES = new Set<SeedanceScenePlan['sourceRoute']>([
  'commons', 'project-source', 'practical-footage', 'generated-image', 'motion-graphic',
  'reconstruction', 'designed-visual',
]);
const REVIEW_SCORE_NAMES: ReviewScoreName[] = [
  'dramaturgy', 'cohesion', 'continuityPotential', 'sourceFit', 'evidenceSafety',
  'productionFeasibility', 'modelFeasibility', 'differentiation', 'costEfficiency',
  'consistencyPotential',
];

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`The kernel returned invalid ${label}.`);
  }
  return value as Record<string, unknown>;
}

export function parseSeedanceStoryPreferences(value: unknown): SeedanceStoryPreferences {
  if (value === undefined) return { ...DEFAULT_SEEDANCE_STORY_PREFERENCES };
  const item = record(value, 'Story preferences');
  const directionCount = item.directionCount;
  const aiGeneration = item.aiGeneration;
  const commons = item.commons;
  const scenePlanning = item.scenePlanning;
  if (directionCount !== 'auto' && directionCount !== 'one' && directionCount !== 'five') {
    throw new Error('The kernel returned an invalid direction-count preference.');
  }
  for (const [name, preference] of [['AI generation', aiGeneration], ['Commons', commons]] as const) {
    if (preference !== 'auto' && preference !== 'enabled' && preference !== 'disabled') {
      throw new Error(`The kernel returned an invalid ${name} preference.`);
    }
  }
  if (scenePlanning !== 'auto' && scenePlanning !== 'root' && scenePlanning !== 'agents') {
    throw new Error('The kernel returned an invalid scene-planning preference.');
  }
  return {
    directionCount,
    aiGeneration: aiGeneration as SeedanceBinaryPreference,
    commons: commons as SeedanceBinaryPreference,
    scenePlanning,
  };
}

function text(value: unknown, maximum: number, label: string, optional = false): string | undefined {
  if (value === undefined && optional) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new Error(`The kernel returned invalid ${label}.`);
  }
  return value;
}

function optionalText(value: unknown, maximum: number, label: string): string | undefined {
  if (value === undefined || (typeof value === 'string' && !value.trim())) return undefined;
  return text(value, maximum, label);
}

function numberValue(value: unknown, maximum: number, label: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`The kernel returned invalid ${label}.`);
  }
  return value;
}

function stringList(value: unknown, maximumItems: number, maximumText: number, label: string): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) throw new Error(`The kernel returned invalid ${label}.`);
  return value.map((item) => text(item, maximumText, label) as string);
}

function optionalExactStringList(
  value: unknown,
  itemCount: number,
  maximumText: number,
  label: string,
): string[] | undefined {
  if (value === undefined) return undefined;
  const values = stringList(value, itemCount, maximumText, label);
  if (values.length !== itemCount) throw new Error(`The kernel returned invalid ${label}.`);
  return values;
}

function parseConcept(value: unknown): VisualStoryConcept {
  const item = record(value, 'visual story concept');
  if (item.schemaVersion !== 1) throw new Error('The kernel returned an unsupported concept version.');
  const visualSummary = optionalExactStringList(item.visualSummary, 3, 500, 'visual summary');
  const visualDramaturgy = optionalExactStringList(item.visualDramaturgy, 10, 700, 'visual dramaturgy');
  return {
    schemaVersion: 1,
    id: text(item.id, 100, 'concept ID') as string,
    title: text(item.title, 140, 'concept title') as string,
    ...(item.deliverableFormat === undefined
      ? {}
      : { deliverableFormat: text(item.deliverableFormat, 300, 'deliverable format') as string }),
    ...(visualSummary === undefined ? {} : { visualSummary }),
    ...(visualDramaturgy === undefined ? {} : { visualDramaturgy }),
    premise: text(item.premise, 600, 'concept premise') as string,
    summary: text(item.summary, 2_000, 'concept summary') as string,
    visualCohesion: text(item.visualCohesion, 1_000, 'visual cohesion') as string,
    productionApproach: text(item.productionApproach, 1_200, 'production approach') as string,
    strongestOpportunity: text(item.strongestOpportunity, 600, 'concept opportunity') as string,
    largestRisk: text(item.largestRisk, 600, 'concept risk') as string,
    ...(item.targetDurationSeconds === undefined
      ? {}
      : { targetDurationSeconds: numberValue(item.targetDurationSeconds, 3_600, 'concept duration', Number.EPSILON) }),
  };
}

function parseReview(value: unknown): VisualStoryConceptReview {
  const item = record(value, 'concept review');
  const recommendation = item.recommendation;
  if (recommendation !== 'keep' && recommendation !== 'revise' && recommendation !== 'replace') {
    throw new Error('The kernel returned an invalid review recommendation.');
  }
  const scoreInput = record(item.scores, 'review scores');
  const scores = Object.fromEntries(REVIEW_SCORE_NAMES.map((name) => [
    name,
    numberValue(scoreInput[name], 5, `review score ${name}`, 1),
  ])) as Record<ReviewScoreName, number>;
  return {
    schemaVersion: 1,
    id: text(item.id, 120, 'review ID') as string,
    conceptId: text(item.conceptId, 100, 'review concept ID') as string,
    recommendation,
    summary: text(item.summary, 1_500, 'review summary') as string,
    scores,
    strengths: stringList(item.strengths, 6, 500, 'review strengths'),
    weaknesses: stringList(item.weaknesses, 6, 500, 'review weaknesses'),
    requiredImprovements: stringList(item.requiredImprovements, 6, 500, 'required improvements'),
    optionalImprovements: stringList(item.optionalImprovements, 6, 500, 'optional improvements'),
    ...(item.alternative === undefined ? {} : { alternative: parseConcept(item.alternative) }),
    ...(item.duplicateOfConceptId === undefined
      ? {}
      : { duplicateOfConceptId: text(item.duplicateOfConceptId, 100, 'duplicate concept ID') as string }),
  };
}

function parseFinalConcept(value: unknown): FinalVisualStoryConcept {
  const concept = parseConcept(value);
  const item = record(value, 'final concept');
  const lineage = record(item.lineage, 'concept lineage');
  const source = lineage.source;
  if (source !== 'original' && source !== 'review-alternative' && source !== 'orchestrator-revision') {
    throw new Error('The kernel returned invalid concept lineage.');
  }
  return {
    ...concept,
    rank: numberValue(item.rank, 5, 'concept rank', 1),
    lineage: {
      originalConceptId: text(lineage.originalConceptId, 100, 'original concept ID') as string,
      ...(lineage.reviewId === undefined
        ? {}
        : { reviewId: text(lineage.reviewId, 120, 'review lineage ID') as string }),
      source,
    },
    changeSummary: text(item.changeSummary, 800, 'concept change summary') as string,
  };
}

function parseAgent(value: unknown): SeedanceAgentRecord {
  const item = record(value, 'agent status');
  if (!AGENT_ROLES.has(item.role as SeedanceAgentRecord['role']) || !AGENT_STATUSES.has(item.status as SeedanceAgentRecord['status'])) {
    throw new Error('The kernel returned an invalid agent lifecycle status.');
  }
  return {
    schemaVersion: 1,
    id: text(item.id, 160, 'agent ID') as string,
    role: item.role as SeedanceAgentRecord['role'],
    status: item.status as SeedanceAgentRecord['status'],
    ...(item.conceptId === undefined ? {} : { conceptId: text(item.conceptId, 100, 'agent concept ID') as string }),
    ...(item.sceneId === undefined ? {} : { sceneId: text(item.sceneId, 100, 'agent scene ID') as string }),
    ...(['startedAt', 'completedAt', 'closedAt'] as const).reduce<Record<string, number>>((result, name) => (
      item[name] === undefined ? result : { ...result, [name]: numberValue(item[name], Number.MAX_SAFE_INTEGER, name) }
    ), {}),
    ...(item.error === undefined ? {} : { error: text(item.error, 1_500, 'agent error') as string }),
  };
}

function parseStory(value: unknown): SeedanceStory {
  const item = record(value, 'story');
  if (item.kind !== 'story' || !Array.isArray(item.scenes) || !Array.isArray(item.researchRequirements)) {
    throw new Error('The kernel returned an invalid story.');
  }
  return {
    schemaVersion: 1,
    kind: 'story',
    title: text(item.title, 180, 'story title') as string,
    logline: text(item.logline, 600, 'story logline') as string,
    summary: text(item.summary, 4_000, 'story summary') as string,
    aspectRatio: text(item.aspectRatio, 20, 'story aspect ratio') as string,
    totalDurationSeconds: numberValue(item.totalDurationSeconds, 3_600, 'story duration', Number.EPSILON),
    scenes: item.scenes.map((sceneValue) => {
      const scene = record(sceneValue, 'story scene');
      return {
        id: text(scene.id, 100, 'scene ID') as string,
        title: text(scene.title, 160, 'scene title') as string,
        summary: text(scene.summary, 1_200, 'scene summary') as string,
        durationSeconds: numberValue(scene.durationSeconds, 300, 'scene duration', Number.EPSILON),
        narration: typeof scene.narration === 'string' ? scene.narration.slice(0, 4_000) : '',
        visualIntent: text(scene.visualIntent, 1_500, 'scene visual intent') as string,
      };
    }),
    researchRequirements: item.researchRequirements.map((requirementValue) => {
      const requirement = record(requirementValue, 'research requirement');
      return {
        id: text(requirement.id, 100, 'research ID') as string,
        query: text(requirement.query, 240, 'research query') as string,
        purpose: text(requirement.purpose, 500, 'research purpose') as string,
        sceneId: text(requirement.sceneId, 100, 'research scene ID') as string,
      };
    }),
  };
}

function parseTreatment(value: unknown): SeedanceVisualTreatment {
  const item = record(value, 'visual treatment');
  if (item.kind !== 'visual-treatment' || !Array.isArray(item.visualWorlds) || !Array.isArray(item.sceneBindings)) {
    throw new Error('The kernel returned an invalid visual treatment.');
  }
  const sourceReview = item.sourceReview === undefined
    ? undefined
    : record(item.sourceReview, 'source review decision');
  if (sourceReview !== undefined && typeof sourceReview.required !== 'boolean') {
    throw new Error('The kernel returned an invalid source review decision.');
  }
  const aiGeneration = item.aiGeneration === undefined
    ? undefined
    : record(item.aiGeneration, 'AI generation decision');
  if (aiGeneration !== undefined && typeof aiGeneration.required !== 'boolean') {
    throw new Error('The kernel returned an invalid AI generation decision.');
  }
  const scenePlanning = item.scenePlanning === undefined
    ? undefined
    : record(item.scenePlanning, 'scene planning decision');
  if (
    scenePlanning !== undefined
    && scenePlanning.mode !== 'root-only'
    && scenePlanning.mode !== 'scene-agents'
  ) {
    throw new Error('The kernel returned an invalid scene planning mode.');
  }
  if (scenePlanning !== undefined && !Array.isArray(scenePlanning.rootScenePlans)) {
    throw new Error('The kernel returned invalid root-authored scene plans.');
  }
  return {
    schemaVersion: 1,
    kind: 'visual-treatment',
    conceptId: text(item.conceptId, 100, 'treatment concept ID') as string,
    visualThesis: text(item.visualThesis, 2_000, 'visual thesis') as string,
    recurringThroughline: text(item.recurringThroughline, 2_000, 'recurring throughline') as string,
    sourceStrategy: text(item.sourceStrategy, 1_500, 'source strategy') as string,
    graphicsPolicy: text(item.graphicsPolicy, 1_500, 'graphics policy') as string,
    generationPolicy: text(item.generationPolicy, 1_500, 'generation policy') as string,
    ...(sourceReview === undefined ? {} : {
      sourceReview: {
        required: sourceReview.required as boolean,
        reason: text(sourceReview.reason, 600, 'source review reason') as string,
      },
    }),
    ...(aiGeneration === undefined ? {} : {
      aiGeneration: {
        required: aiGeneration.required as boolean,
        reason: text(aiGeneration.reason, 800, 'AI generation reason') as string,
      },
    }),
    ...(scenePlanning === undefined ? {} : {
      scenePlanning: {
        mode: scenePlanning.mode as 'root-only' | 'scene-agents',
        reason: text(scenePlanning.reason, 1_000, 'scene planning reason') as string,
        rootScenePlans: (scenePlanning.rootScenePlans as unknown[]).map(parseScenePlan),
      },
    }),
    visualWorlds: item.visualWorlds.map((worldValue) => {
      const world = record(worldValue, 'Visual World');
      return {
        schemaVersion: 1,
        id: text(world.id, 120, 'Visual World ID') as string,
        title: text(world.title, 180, 'Visual World title') as string,
        narrativePurpose: text(world.narrativePurpose, 1_200, 'Visual World purpose') as string,
        visualRules: stringList(world.visualRules, 10, 700, 'visual rules'),
        paletteAndLight: text(world.paletteAndLight, 1_000, 'palette and light') as string,
        recurringElements: stringList(world.recurringElements, 10, 500, 'recurring elements'),
        continuityRules: stringList(world.continuityRules, 10, 700, 'continuity rules'),
        referenceStrategy: text(world.referenceStrategy, 1_200, 'reference strategy') as string,
        requiresNewReferences: world.requiresNewReferences === true,
        plannedReferenceCount: numberValue(world.plannedReferenceCount, 8, 'reference count'),
      };
    }),
    sceneBindings: item.sceneBindings.map((bindingValue) => {
      const binding = record(bindingValue, 'scene binding');
      return {
        schemaVersion: 1,
        sceneId: text(binding.sceneId, 100, 'binding scene ID') as string,
        visualWorldId: text(binding.visualWorldId, 120, 'binding world ID') as string,
        visualState: text(binding.visualState, 800, 'visual state') as string,
        transitionIn: text(binding.transitionIn, 800, 'transition in') as string,
        transitionOut: text(binding.transitionOut, 800, 'transition out') as string,
      };
    }),
  };
}

function parseScenePlan(value: unknown): SeedanceScenePlan {
  const item = record(value, 'scene plan');
  if (!SOURCE_ROUTES.has(item.sourceRoute as SeedanceScenePlan['sourceRoute'])) {
    throw new Error('The kernel returned an invalid scene source route.');
  }
  if (item.status !== 'draft' && item.status !== 'reviewed' && item.status !== 'accepted') {
    throw new Error('The kernel returned an invalid scene-plan status.');
  }
  const visualWorldChangeRequest = optionalText(item.visualWorldChangeRequest, 1_000, 'world change request');
  const promptDraft = optionalText(item.promptDraft, 8_000, 'prompt draft');
  return {
    schemaVersion: 1,
    sceneId: text(item.sceneId, 100, 'scene-plan scene ID') as string,
    revision: numberValue(item.revision, Number.MAX_SAFE_INTEGER, 'scene-plan revision', 1),
    dramaturgicalFunction: text(item.dramaturgicalFunction, 1_200, 'dramaturgical function') as string,
    visualProposal: text(item.visualProposal, 2_000, 'visual proposal') as string,
    continuityIn: text(item.continuityIn, 1_000, 'continuity in') as string,
    continuityOut: text(item.continuityOut, 1_000, 'continuity out') as string,
    visualWorldId: text(item.visualWorldId, 120, 'visual world ID') as string,
    ...(visualWorldChangeRequest === undefined ? {} : { visualWorldChangeRequest }),
    sourceRoute: item.sourceRoute as SeedanceScenePlan['sourceRoute'],
    sourcePlan: text(item.sourcePlan, 1_500, 'source plan') as string,
    commonsQueries: stringList(item.commonsQueries, 3, 240, 'Commons queries'),
    cameraDirection: text(item.cameraDirection, 1_000, 'camera direction') as string,
    ...(promptDraft === undefined ? {} : { promptDraft }),
    risks: stringList(item.risks, 8, 500, 'scene risks'),
    status: item.status,
  };
}

export function parseSeedanceScenePlan(value: unknown): SeedanceScenePlan {
  return parseScenePlan(value);
}

export function parseSeedanceOrchestrationRun(value: unknown): SeedanceOrchestrationPublicRun {
  const item = record(value, 'orchestration run');
  if (item.schemaVersion !== 1 || item.kind !== 'seedance-orchestration-run' || !PHASES.has(item.phase as SeedanceOrchestrationPhase)) {
    throw new Error('The kernel returned an unsupported orchestration run.');
  }
  if (!Array.isArray(item.drafts) || !Array.isArray(item.reviews) || !Array.isArray(item.finalConcepts) || !Array.isArray(item.agents)) {
    throw new Error('The kernel returned incomplete orchestration projections.');
  }
  return {
    schemaVersion: 1,
    kind: 'seedance-orchestration-run',
    runId: text(item.runId, 220, 'orchestration run ID') as string,
    prompt: text(item.prompt, 4_000, 'orchestration prompt') as string,
    sourceBundleId: text(item.sourceBundleId, 100, 'source-bundle ID') as string,
    snapshotFingerprint: text(item.snapshotFingerprint, 64, 'snapshot fingerprint') as string,
    preferences: parseSeedanceStoryPreferences(item.preferences),
    phase: item.phase as SeedanceOrchestrationPhase,
    createdAt: numberValue(item.createdAt, Number.MAX_SAFE_INTEGER, 'run creation time'),
    updatedAt: numberValue(item.updatedAt, Number.MAX_SAFE_INTEGER, 'run update time'),
    nextSequence: numberValue(item.nextSequence, Number.MAX_SAFE_INTEGER, 'next event sequence', 1),
    drafts: item.drafts.map(parseConcept),
    reviews: item.reviews.map(parseReview),
    finalConcepts: item.finalConcepts.map(parseFinalConcept),
    ...(item.selectedConceptId === undefined ? {} : { selectedConceptId: text(item.selectedConceptId, 100, 'selected concept ID') as string }),
    ...(item.story === undefined ? {} : { story: parseStory(item.story) }),
    ...(item.treatment === undefined ? {} : { treatment: parseTreatment(item.treatment) }),
    scenePlanCount: numberValue(item.scenePlanCount, 80, 'scene-plan count'),
    agents: item.agents.map(parseAgent),
    ...(item.error === undefined ? {} : { error: text(item.error, 1_500, 'orchestration error') as string }),
  };
}

export function parseSeedanceOrchestrationEvent(value: unknown): SeedanceOrchestrationEvent {
  const item = record(value, 'orchestration event');
  const base = {
    schemaVersion: 1 as const,
    eventId: text(item.eventId, 240, 'event ID') as string,
    runId: text(item.runId, 220, 'event run ID') as string,
    sequence: numberValue(item.sequence, Number.MAX_SAFE_INTEGER, 'event sequence', 1),
    createdAt: numberValue(item.createdAt, Number.MAX_SAFE_INTEGER, 'event time'),
    ...(item.agentId === undefined ? {} : { agentId: text(item.agentId, 160, 'event agent ID') as string }),
    ...(item.conceptId === undefined ? {} : { conceptId: text(item.conceptId, 100, 'event concept ID') as string }),
    ...(item.sceneId === undefined ? {} : { sceneId: text(item.sceneId, 100, 'event scene ID') as string }),
  };
  const payload = record(item.payload, 'event payload');
  switch (item.kind) {
    case 'run.started':
    case 'run.phase':
      if (!PHASES.has(payload.phase as SeedanceOrchestrationPhase)) throw new Error('Invalid phase event.');
      return { ...base, kind: item.kind, payload: { phase: payload.phase as SeedanceOrchestrationPhase } };
    case 'root.ready': return { ...base, kind: item.kind, payload: { resumed: payload.resumed === true } };
    case 'agent.status': return { ...base, kind: item.kind, payload: parseAgent(payload) };
    case 'concept.draft': return { ...base, kind: item.kind, payload: parseConcept(payload) };
    case 'concepts.reset':
    case 'finals.reset': return { ...base, kind: item.kind, payload: { reason: text(payload.reason, 500, 'reset reason') as string } };
    case 'review.completed': return { ...base, kind: item.kind, payload: parseReview(payload) };
    case 'orchestrator.status': {
      const status = payload.status;
      if (status !== 'considering' && status !== 'revising' && status !== 'replacing' && status !== 'ordering') throw new Error('Invalid orchestrator status.');
      return { ...base, kind: item.kind, payload: { status, message: text(payload.message, 600, 'orchestrator message') as string } };
    }
    case 'concept.final': return { ...base, kind: item.kind, payload: parseFinalConcept(payload) };
    case 'concepts.finalized': return { ...base, kind: item.kind, payload: { orderedConceptIds: stringList(payload.orderedConceptIds, 5, 100, 'final concept order') } };
    case 'selection.accepted': return { ...base, kind: item.kind, payload: { selectedConceptId: text(payload.selectedConceptId, 100, 'selected concept ID') as string } };
    case 'story.completed': return { ...base, kind: item.kind, payload: parseStory(payload) };
    case 'treatment.completed': return { ...base, kind: item.kind, payload: parseTreatment(payload) };
    case 'scene.plan': return { ...base, kind: item.kind, payload: parseScenePlan(payload) };
    case 'run.failed': return { ...base, kind: item.kind, payload: { error: text(payload.error, 1_500, 'run error') as string } };
    case 'run.cancelled': return { ...base, kind: item.kind, payload: { reason: text(payload.reason, 1_000, 'cancel reason') as string } };
    default: throw new Error(`The kernel returned unsupported orchestration event ${String(item.kind)}.`);
  }
}

export function reduceSeedanceOrchestrationEvent(
  current: SeedanceOrchestrationPublicRun,
  event: SeedanceOrchestrationEvent,
): SeedanceOrchestrationPublicRun {
  if (event.runId !== current.runId || event.sequence >= current.nextSequence + 10_000) return current;
  const next = { ...current, updatedAt: Math.max(current.updatedAt, event.createdAt), nextSequence: Math.max(current.nextSequence, event.sequence + 1) };
  switch (event.kind) {
    case 'run.started':
    case 'run.phase': return { ...next, phase: event.payload.phase };
    case 'agent.status': return {
      ...next,
      agents: [...next.agents.filter((agent) => agent.id !== event.payload.id), event.payload],
    };
    case 'concept.draft': return {
      ...next,
      drafts: [...next.drafts.filter((concept) => concept.id !== event.payload.id), event.payload],
    };
    case 'concepts.reset': return { ...next, drafts: [] };
    case 'review.completed': return {
      ...next,
      reviews: [...next.reviews.filter((review) => review.conceptId !== event.payload.conceptId), event.payload],
    };
    case 'concept.final': return {
      ...next,
      finalConcepts: [...next.finalConcepts.filter((concept) => concept.id !== event.payload.id), event.payload],
    };
    case 'finals.reset': return { ...next, finalConcepts: [] };
    case 'concepts.finalized': {
      const byId = new Map(next.finalConcepts.map((concept) => [concept.id, concept]));
      return { ...next, finalConcepts: event.payload.orderedConceptIds.flatMap((id) => byId.get(id) ?? []) };
    }
    case 'selection.accepted': return { ...next, selectedConceptId: event.payload.selectedConceptId };
    case 'story.completed': return { ...next, story: event.payload };
    case 'treatment.completed': return { ...next, treatment: event.payload };
    case 'scene.plan': return next;
    case 'run.failed': return { ...next, phase: 'failed', error: event.payload.error };
    case 'run.cancelled': return { ...next, phase: 'cancelled', error: event.payload.reason };
    default: return next;
  }
}
