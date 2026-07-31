import type {
  StoryboardGenerationBrief,
  StoryboardProjectState,
  StoryboardScene,
  StoryboardTemplate,
  StoryboardTemplateBeat,
} from '../contracts';

export type StoryboardTemplateOrigin = 'built-in' | 'custom';

export interface StoryboardTemplateCatalogEntry {
  readonly origin: StoryboardTemplateOrigin;
  readonly template: StoryboardTemplate;
}

export interface StoryboardTemplateMigrationStep {
  readonly templateId: string;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly migrate: (template: StoryboardTemplate) => StoryboardTemplate;
}

export interface DecodedStoryboardTemplateRecord {
  readonly templates: Readonly<Record<string, StoryboardTemplate>>;
  readonly migratedTemplateIds: readonly string[];
}

export interface StoryboardExpandedTemplateBeat {
  readonly beat: StoryboardTemplateBeat;
  readonly targetShare: number;
  readonly targetDurationSeconds: number;
}

export type StoryboardTemplateMappingConfidence =
  | 'manual'
  | 'beat-id'
  | 'title'
  | 'scene-kind'
  | 'position';

export interface StoryboardTemplateSceneMapping {
  readonly sceneId: string;
  readonly beatId: string;
  readonly confidence: StoryboardTemplateMappingConfidence;
  readonly reason: string;
}

export interface StoryboardTemplateMappingResult {
  readonly mappings: readonly StoryboardTemplateSceneMapping[];
  readonly unmappedSceneIds: readonly string[];
  readonly unmappedBeatIds: readonly string[];
}

export type StoryboardTemplateApplicationMode =
  | 'instantiate'
  | 'merge'
  | 'map'
  | 'restructure';

export type StoryboardTemplateDiffEntity =
  | 'plan'
  | 'scene'
  | 'generation-brief'
  | 'candidate'
  | 'evidence'
  | 'coverage'
  | 'decision';

export type StoryboardTemplateDiffOperation =
  | 'add'
  | 'remove'
  | 'update'
  | 'reorder';

export interface StoryboardTemplateDiffEntry {
  readonly id: string;
  readonly entity: StoryboardTemplateDiffEntity;
  readonly entityId: string;
  readonly operation: StoryboardTemplateDiffOperation;
  readonly destructive: boolean;
  readonly summary: string;
  readonly before?: unknown;
  readonly after?: unknown;
}

export interface StoryboardTemplateApplicationPreview {
  readonly schemaVersion: 1;
  readonly mode: StoryboardTemplateApplicationMode;
  readonly templateId: string;
  readonly templateVersion: number;
  readonly planId: string;
  readonly baseFingerprint: string;
  readonly targetFingerprint: string;
  readonly diffFingerprint: string;
  readonly differences: readonly StoryboardTemplateDiffEntry[];
  readonly mappings: readonly StoryboardTemplateSceneMapping[];
  readonly requiresConfirmation: boolean;
  readonly confirmedDiffFingerprint?: string;
}

export interface PreviewStoryboardTemplateApplicationInput {
  readonly state: StoryboardProjectState;
  readonly template: StoryboardTemplate;
  readonly mode: StoryboardTemplateApplicationMode;
  readonly planId: string;
  readonly planTitle?: string;
  readonly targetDurationSeconds?: number;
  readonly explicitMappings?: Readonly<Record<string, string>>;
  readonly now?: number;
  readonly createSceneId?: (beat: StoryboardTemplateBeat, index: number) => string;
  readonly createGenerationBriefId?: (
    beat: StoryboardTemplateBeat,
    scene: StoryboardScene,
    index: number,
  ) => string;
}

export interface CreateCustomStoryboardTemplateInput {
  readonly state: StoryboardProjectState;
  readonly planId: string;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version?: number;
  readonly includeGenerationDefaults?: boolean;
}

export type StoryboardTemplateGenerationDefaults = Omit<
  StoryboardGenerationBrief,
  'schemaVersion' | 'id' | 'sceneId' | 'revision' | 'createdAt'
>;
