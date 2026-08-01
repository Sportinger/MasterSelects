import type { MotionContentDependency } from '../presets/contracts';
import {
  cloneMotionJsonValue,
  inspectMotionJsonSafety,
  type MotionJsonObject,
} from '../presets/jsonSafety';
import {
  MOTION_TEMPLATE_CODEC_ERROR_CODES,
  MOTION_TEMPLATE_FORMAT,
  MOTION_TEMPLATE_VERSION,
  type MotionTemplateCodecFailure,
  type MotionTemplateCodecResult,
  type MotionTemplateEntityV1,
  type MotionTemplateEnvelopeV1,
  type MotionTemplateRelationshipV1,
} from './contracts';

const ENVELOPE_KEYS = new Set([
  'format', 'version', 'scope', 'templateId', 'name', 'category', 'duration',
  'entities', 'relationships', 'dependencies',
]);
const ENTITY_KEYS = new Set(['id', 'kind', 'startOffset', 'duration', 'payload', 'dependencyIds']);
const RELATIONSHIP_KEYS = new Set(['id', 'kind', 'fromEntityId', 'toEntityId', 'payload']);
const DEPENDENCY_KEYS = new Set(['id', 'kind', 'sourceProjectId', 'label']);
const DEPENDENCY_KINDS = new Set(['media', 'composition', 'font']);
const KIND_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNativeArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return isNativeArray(value) && value.every((item) => typeof item === 'string' && item.length > 0);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function failure(
  code: MotionTemplateCodecFailure['code'],
  path: string,
  message: string,
): MotionTemplateCodecFailure {
  return { code, path, message };
}

function validateJsonObject(
  value: unknown,
  path: string,
  failures: MotionTemplateCodecFailure[],
): value is MotionJsonObject {
  if (!isRecord(value)) {
    failures.push(failure(
      MOTION_TEMPLATE_CODEC_ERROR_CODES.MALFORMED_ENVELOPE,
      path,
      'Template payload must be a JSON object.',
    ));
    return false;
  }
  const safety = inspectMotionJsonSafety(value);
  if (!safety.ok) {
    failures.push(...safety.failures.map((item) => failure(
      MOTION_TEMPLATE_CODEC_ERROR_CODES.JSON_UNSAFE,
      `${path}${item.path.slice(1)}`,
      item.message,
    )));
    return false;
  }
  return true;
}

export function decodeMotionTemplateEnvelope(input: string | unknown): MotionTemplateCodecResult {
  let value: unknown = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input) as unknown;
    } catch {
      return {
        ok: false,
        failures: [failure(
          MOTION_TEMPLATE_CODEC_ERROR_CODES.MALFORMED_JSON,
          '$',
          'Template input is not valid JSON.',
        )],
      };
    }
  }
  const envelopeSafety = inspectMotionJsonSafety(value);
  if (!envelopeSafety.ok) {
    return {
      ok: false,
      failures: envelopeSafety.failures.map((item) => failure(
        MOTION_TEMPLATE_CODEC_ERROR_CODES.JSON_UNSAFE,
        item.path,
        item.message,
      )),
    };
  }
  if (!isRecord(value) || !hasOnlyKeys(value, ENVELOPE_KEYS)) {
    return {
      ok: false,
      failures: [failure(
        MOTION_TEMPLATE_CODEC_ERROR_CODES.MALFORMED_ENVELOPE,
        '$',
        'Template envelope has an invalid object shape or unknown fields.',
      )],
    };
  }
  if (value.format !== MOTION_TEMPLATE_FORMAT || value.scope !== 'project-local') {
    return {
      ok: false,
      failures: [failure(
        MOTION_TEMPLATE_CODEC_ERROR_CODES.MALFORMED_ENVELOPE,
        '$.format',
        'Template format and scope must match the project-local contract.',
      )],
    };
  }
  if (value.version !== MOTION_TEMPLATE_VERSION) {
    return {
      ok: false,
      failures: [failure(
        MOTION_TEMPLATE_CODEC_ERROR_CODES.UNKNOWN_VERSION,
        '$.version',
        'Template version is not supported.',
      )],
    };
  }
  if (
    typeof value.templateId !== 'string' || !value.templateId ||
    typeof value.name !== 'string' || !value.name ||
    typeof value.category !== 'string' || !value.category ||
    typeof value.duration !== 'number' || !Number.isFinite(value.duration) || value.duration <= 0 ||
    !isNativeArray(value.entities) ||
    value.entities.length === 0 ||
    !isNativeArray(value.relationships) ||
    !isNativeArray(value.dependencies)
  ) {
    return {
      ok: false,
      failures: [failure(
        MOTION_TEMPLATE_CODEC_ERROR_CODES.MALFORMED_ENVELOPE,
        '$',
        'Template metadata, duration, or collections are malformed.',
      )],
    };
  }

  const failures: MotionTemplateCodecFailure[] = [];
  const entities: MotionTemplateEntityV1[] = [];
  const entityIds = new Set<string>();
  for (let index = 0; index < value.entities.length; index += 1) {
    const candidate = value.entities[index];
    const path = `$.entities[${index}]`;
    if (
      !isRecord(candidate) ||
      !hasOnlyKeys(candidate, ENTITY_KEYS) ||
      typeof candidate.id !== 'string' || !candidate.id ||
      typeof candidate.kind !== 'string' || !KIND_PATTERN.test(candidate.kind) ||
      typeof candidate.startOffset !== 'number' || !Number.isFinite(candidate.startOffset) ||
      candidate.startOffset < 0 ||
      typeof candidate.duration !== 'number' || !Number.isFinite(candidate.duration) ||
      candidate.duration <= 0 ||
      candidate.startOffset + candidate.duration > value.duration ||
      !isNonEmptyStringArray(candidate.dependencyIds) ||
      new Set(candidate.dependencyIds).size !== candidate.dependencyIds.length ||
      !validateJsonObject(candidate.payload, `${path}.payload`, failures)
    ) {
      failures.push(failure(
        MOTION_TEMPLATE_CODEC_ERROR_CODES.MALFORMED_ENVELOPE,
        path,
        'Template entity is malformed or outside the template duration.',
      ));
      continue;
    }
    if (entityIds.has(candidate.id)) {
      failures.push(failure(
        MOTION_TEMPLATE_CODEC_ERROR_CODES.DUPLICATE_ENTITY,
        `${path}.id`,
        'Template entity ids must be unique.',
      ));
      continue;
    }
    entityIds.add(candidate.id);
    entities.push({
      id: candidate.id,
      kind: candidate.kind,
      startOffset: candidate.startOffset,
      duration: candidate.duration,
      payload: cloneMotionJsonValue(candidate.payload),
      dependencyIds: [...candidate.dependencyIds],
    });
  }

  const dependencies: MotionContentDependency[] = [];
  const dependencyIds = new Set<string>();
  for (let index = 0; index < value.dependencies.length; index += 1) {
    const candidate = value.dependencies[index];
    const path = `$.dependencies[${index}]`;
    if (
      !isRecord(candidate) || !hasOnlyKeys(candidate, DEPENDENCY_KEYS) ||
      typeof candidate.id !== 'string' || !candidate.id ||
      typeof candidate.kind !== 'string' || !DEPENDENCY_KINDS.has(candidate.kind) ||
      typeof candidate.sourceProjectId !== 'string' || !candidate.sourceProjectId ||
      (candidate.label !== undefined && typeof candidate.label !== 'string')
    ) {
      failures.push(failure(
        MOTION_TEMPLATE_CODEC_ERROR_CODES.MALFORMED_ENVELOPE,
        path,
        'Template dependency is malformed.',
      ));
      continue;
    }
    if (dependencyIds.has(candidate.id)) {
      failures.push(failure(
        MOTION_TEMPLATE_CODEC_ERROR_CODES.DUPLICATE_DEPENDENCY,
        `${path}.id`,
        'Template dependency ids must be unique.',
      ));
      continue;
    }
    dependencyIds.add(candidate.id);
    dependencies.push({
      id: candidate.id,
      kind: candidate.kind as MotionContentDependency['kind'],
      sourceProjectId: candidate.sourceProjectId,
      ...(typeof candidate.label === 'string' ? { label: candidate.label } : {}),
    });
  }

  const relationships: MotionTemplateRelationshipV1[] = [];
  const relationshipIds = new Set<string>();
  for (let index = 0; index < value.relationships.length; index += 1) {
    const candidate = value.relationships[index];
    const path = `$.relationships[${index}]`;
    if (
      !isRecord(candidate) || !hasOnlyKeys(candidate, RELATIONSHIP_KEYS) ||
      typeof candidate.id !== 'string' || !candidate.id ||
      typeof candidate.kind !== 'string' || !KIND_PATTERN.test(candidate.kind) ||
      typeof candidate.fromEntityId !== 'string' || !candidate.fromEntityId ||
      typeof candidate.toEntityId !== 'string' || !candidate.toEntityId ||
      !validateJsonObject(candidate.payload, `${path}.payload`, failures)
    ) {
      failures.push(failure(
        MOTION_TEMPLATE_CODEC_ERROR_CODES.MALFORMED_ENVELOPE,
        path,
        'Template relationship is malformed.',
      ));
      continue;
    }
    if (relationshipIds.has(candidate.id)) {
      failures.push(failure(
        MOTION_TEMPLATE_CODEC_ERROR_CODES.DUPLICATE_RELATIONSHIP,
        `${path}.id`,
        'Template relationship ids must be unique.',
      ));
      continue;
    }
    relationshipIds.add(candidate.id);
    if (!entityIds.has(candidate.fromEntityId) || !entityIds.has(candidate.toEntityId)) {
      failures.push(failure(
        MOTION_TEMPLATE_CODEC_ERROR_CODES.MISSING_ENTITY,
        path,
        'Template relationship references an undeclared entity.',
      ));
      continue;
    }
    relationships.push({
      id: candidate.id,
      kind: candidate.kind,
      fromEntityId: candidate.fromEntityId,
      toEntityId: candidate.toEntityId,
      payload: cloneMotionJsonValue(candidate.payload),
    });
  }

  for (const entity of entities) {
    for (const dependencyId of entity.dependencyIds) {
      if (!dependencyIds.has(dependencyId)) {
        failures.push(failure(
          MOTION_TEMPLATE_CODEC_ERROR_CODES.MISSING_DEPENDENCY_DECLARATION,
          `$.entities.${entity.id}.dependencyIds`,
          'Template entity references an undeclared dependency.',
        ));
      }
    }
  }
  if (failures.length > 0) return { ok: false, failures };

  return {
    ok: true,
    envelope: {
      format: MOTION_TEMPLATE_FORMAT,
      version: MOTION_TEMPLATE_VERSION,
      scope: 'project-local',
      templateId: value.templateId,
      name: value.name,
      category: value.category,
      duration: value.duration,
      entities,
      relationships,
      dependencies,
    },
  };
}

export function encodeMotionTemplateEnvelope(envelope: MotionTemplateEnvelopeV1): MotionTemplateCodecResult & {
  readonly json?: string;
} {
  const decoded = decodeMotionTemplateEnvelope(envelope);
  return decoded.ok
    ? { ...decoded, json: JSON.stringify(decoded.envelope) }
    : decoded;
}
