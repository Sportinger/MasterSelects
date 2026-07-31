import {
  assertStoryboardTemplate,
  isPlainRecord,
  type StoryboardTemplate,
} from '../contracts';
import { isBuiltInStoryboardTemplateId } from './builtInTemplates';
import type {
  DecodedStoryboardTemplateRecord,
  StoryboardTemplateMigrationStep,
} from './types';
import { assertStoryboardTemplateSemantics } from './validation';

function sortedTemplateRecord(
  templates: Readonly<Record<string, StoryboardTemplate>>,
): Record<string, StoryboardTemplate> {
  return Object.fromEntries(
    Object.entries(templates)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([id, template]) => [id, structuredClone(template)]),
  );
}

export function migrateStoryboardTemplateVersion(
  source: StoryboardTemplate,
  targetVersion: number,
  migrations: readonly StoryboardTemplateMigrationStep[],
): StoryboardTemplate {
  if (!Number.isInteger(targetVersion) || targetVersion < 1) {
    throw new Error('Template target version must be a positive integer.');
  }
  let current = structuredClone(source);
  assertStoryboardTemplateSemantics(current);
  if (current.version > targetVersion) {
    throw new Error(
      `Template ${current.id} version ${current.version} is newer than supported version ${targetVersion}.`,
    );
  }
  while (current.version < targetVersion) {
    const candidates = migrations.filter(step =>
      step.templateId === current.id &&
      step.fromVersion === current.version
    );
    if (candidates.length !== 1) {
      throw new Error(
        `Template ${current.id} needs exactly one migration from version ${current.version}.`,
      );
    }
    const step = candidates[0];
    if (
      !Number.isInteger(step.toVersion) ||
      step.toVersion <= step.fromVersion ||
      step.toVersion > targetVersion
    ) {
      throw new Error(`Template ${current.id} has an invalid migration step.`);
    }
    const migrated = step.migrate(structuredClone(current));
    assertStoryboardTemplate(migrated, `templateMigration.${current.id}.v${step.toVersion}`);
    assertStoryboardTemplateSemantics(
      migrated,
      `templateMigration.${current.id}.v${step.toVersion}`,
    );
    if (migrated.id !== current.id || migrated.version !== step.toVersion) {
      throw new Error(
        `Template migration ${current.id} v${step.fromVersion} must preserve id and emit v${step.toVersion}.`,
      );
    }
    current = structuredClone(migrated);
  }
  return current;
}

export function decodeStoryboardTemplateRecord(
  value: unknown,
  options: {
    readonly targetVersions?: Readonly<Record<string, number>>;
    readonly migrations?: readonly StoryboardTemplateMigrationStep[];
  } = {},
): DecodedStoryboardTemplateRecord {
  if (!isPlainRecord(value)) {
    throw new Error('Storyboard template persistence field must be an object record.');
  }
  const migratedTemplateIds: string[] = [];
  const templates: Record<string, StoryboardTemplate> = {};
  for (const [id, rawTemplate] of Object.entries(value).toSorted(([left], [right]) =>
    left.localeCompare(right)
  )) {
    assertStoryboardTemplate(rawTemplate, `templates.${id}`);
    assertStoryboardTemplateSemantics(rawTemplate, `templates.${id}`);
    if (rawTemplate.id !== id) {
      throw new Error(`Persisted template key ${id} does not match template id ${rawTemplate.id}.`);
    }
    if (isBuiltInStoryboardTemplateId(id)) {
      throw new Error(`Project persistence cannot override built-in template ${id}.`);
    }
    const targetVersion = options.targetVersions?.[id] ?? rawTemplate.version;
    const template = migrateStoryboardTemplateVersion(
      rawTemplate,
      targetVersion,
      options.migrations ?? [],
    );
    if (template.version !== rawTemplate.version) migratedTemplateIds.push(id);
    templates[id] = template;
  }
  return {
    templates: sortedTemplateRecord(templates),
    migratedTemplateIds,
  };
}

export function encodeStoryboardTemplateRecord(
  templates: Readonly<Record<string, StoryboardTemplate>>,
): Record<string, StoryboardTemplate> {
  return decodeStoryboardTemplateRecord(templates).templates as Record<string, StoryboardTemplate>;
}

export const storyboardTemplatePersistenceAdapter = {
  decode: decodeStoryboardTemplateRecord,
  encode: encodeStoryboardTemplateRecord,
} as const;
