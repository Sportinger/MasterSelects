import {
  MOTION_PRESET_CODEC_ERROR_CODES,
  MOTION_PRESET_FORMAT,
  MOTION_PRESET_VERSION,
  type MotionContentDependency,
  type MotionPresetCodecFailure,
  type MotionPresetCodecResult,
  type MotionPresetEnvelopeV1,
  type MotionPresetKind,
} from './contracts';
import { cloneMotionJsonValue, inspectMotionJsonSafety, type MotionJsonObject } from './jsonSafety';

const PRESET_KINDS = new Set<MotionPresetKind>([
  'shape',
  'appearance',
  'graph-easing',
  'replicator',
]);
const DEPENDENCY_KINDS = new Set(['media', 'composition', 'font']);
const ENVELOPE_KEYS = new Set([
  'format', 'version', 'scope', 'presetId', 'name', 'kind', 'payload', 'dependencies',
]);
const DEPENDENCY_KEYS = new Set(['id', 'kind', 'sourceProjectId', 'label']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNativeArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function failure(
  code: MotionPresetCodecFailure['code'],
  path: string,
  message: string,
): MotionPresetCodecFailure {
  return { code, path, message };
}

export function decodeMotionPresetEnvelope(input: string | unknown): MotionPresetCodecResult {
  let value: unknown = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input) as unknown;
    } catch {
      return {
        ok: false,
        failures: [failure(
          MOTION_PRESET_CODEC_ERROR_CODES.MALFORMED_JSON,
          '$',
          'Preset input is not valid JSON.',
        )],
      };
    }
  }

  const envelopeSafety = inspectMotionJsonSafety(value);
  if (!envelopeSafety.ok) {
    return {
      ok: false,
      failures: envelopeSafety.failures.map((item) => failure(
        MOTION_PRESET_CODEC_ERROR_CODES.JSON_UNSAFE,
        item.path,
        item.message,
      )),
    };
  }

  if (!isRecord(value) || !hasOnlyKeys(value, ENVELOPE_KEYS)) {
    return {
      ok: false,
      failures: [failure(
        MOTION_PRESET_CODEC_ERROR_CODES.MALFORMED_ENVELOPE,
        '$',
        'Preset envelope has an invalid object shape or unknown fields.',
      )],
    };
  }
  if (value.format !== MOTION_PRESET_FORMAT || value.scope !== 'project-local') {
    return {
      ok: false,
      failures: [failure(
        MOTION_PRESET_CODEC_ERROR_CODES.MALFORMED_ENVELOPE,
        '$.format',
        'Preset format and scope must match the project-local contract.',
      )],
    };
  }
  if (value.version !== MOTION_PRESET_VERSION) {
    return {
      ok: false,
      failures: [failure(
        MOTION_PRESET_CODEC_ERROR_CODES.UNKNOWN_VERSION,
        '$.version',
        'Preset version is not supported.',
      )],
    };
  }
  if (typeof value.presetId !== 'string' || !value.presetId || typeof value.name !== 'string' || !value.name) {
    return {
      ok: false,
      failures: [failure(
        MOTION_PRESET_CODEC_ERROR_CODES.MALFORMED_ENVELOPE,
        '$',
        'Preset id and name must be non-empty strings.',
      )],
    };
  }
  if (typeof value.kind !== 'string' || !PRESET_KINDS.has(value.kind as MotionPresetKind)) {
    return {
      ok: false,
      failures: [failure(
        MOTION_PRESET_CODEC_ERROR_CODES.UNKNOWN_KIND,
        '$.kind',
        'Preset kind is not supported by version 1.',
      )],
    };
  }
  if (!isRecord(value.payload) || !isNativeArray(value.dependencies)) {
    return {
      ok: false,
      failures: [failure(
        MOTION_PRESET_CODEC_ERROR_CODES.MALFORMED_ENVELOPE,
        '$',
        'Preset payload must be an object and dependencies must be an array.',
      )],
    };
  }

  const jsonSafety = inspectMotionJsonSafety(value.payload);
  if (!jsonSafety.ok) {
    return {
      ok: false,
      failures: jsonSafety.failures.map((item) => failure(
        MOTION_PRESET_CODEC_ERROR_CODES.JSON_UNSAFE,
        item.path,
        item.message,
      )),
    };
  }

  const dependencies: MotionContentDependency[] = [];
  const dependencyIds = new Set<string>();
  const dependencyFailures: MotionPresetCodecFailure[] = [];
  for (let index = 0; index < value.dependencies.length; index += 1) {
    const candidate = value.dependencies[index];
    const path = `$.dependencies[${index}]`;
    if (
      !isRecord(candidate) ||
      !hasOnlyKeys(candidate, DEPENDENCY_KEYS) ||
      typeof candidate.id !== 'string' ||
      !candidate.id ||
      typeof candidate.kind !== 'string' ||
      !DEPENDENCY_KINDS.has(candidate.kind) ||
      typeof candidate.sourceProjectId !== 'string' ||
      !candidate.sourceProjectId ||
      (candidate.label !== undefined && typeof candidate.label !== 'string')
    ) {
      dependencyFailures.push(failure(
        MOTION_PRESET_CODEC_ERROR_CODES.MALFORMED_ENVELOPE,
        path,
        'Preset dependency is malformed.',
      ));
      continue;
    }
    if (dependencyIds.has(candidate.id)) {
      dependencyFailures.push(failure(
        MOTION_PRESET_CODEC_ERROR_CODES.DUPLICATE_DEPENDENCY,
        `${path}.id`,
        'Preset dependency ids must be unique.',
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
  if (dependencyFailures.length > 0) return { ok: false, failures: dependencyFailures };

  return {
    ok: true,
    envelope: {
      format: MOTION_PRESET_FORMAT,
      version: MOTION_PRESET_VERSION,
      scope: 'project-local',
      presetId: value.presetId,
      name: value.name,
      kind: value.kind as MotionPresetKind,
      payload: cloneMotionJsonValue(value.payload as MotionJsonObject),
      dependencies,
    },
  };
}

export function encodeMotionPresetEnvelope(envelope: MotionPresetEnvelopeV1): MotionPresetCodecResult & {
  readonly json?: string;
} {
  const decoded = decodeMotionPresetEnvelope(envelope);
  return decoded.ok
    ? { ...decoded, json: JSON.stringify(decoded.envelope) }
    : decoded;
}
