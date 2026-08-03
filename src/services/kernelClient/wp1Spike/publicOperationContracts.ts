export type PublicOperationIdV1 =
  | 'timeline.editor.catalog.v1'
  | 'timeline.editor.destructive.v1'
  | 'timeline.editor.inspect.v1'
  | 'timeline.editor.mutate.v1'
  | 'timeline.hook.commit.v1'
  | 'timeline.hook.preview.v1'
  | 'timeline.hook.refine.commit.v1'
  | 'timeline.intercut.commit.v1'
  | 'timeline.intercut.preview.v1'
  | 'timeline.segment.delete-many.v1'
  | 'timeline.segment.split.v1'
  | 'timeline.editor.program.commit.v1'
  | 'timeline.editor.program.preview.v1'
  | 'timeline.visual.capture-grid.v1';

export type PublicOperationEffectV1 =
  | 'mediaDuration'
  | 'segmentation'
  | 'sourceCoverage'
  | 'sourceOrder'
  | 'timelinePlacement';

export type PublicEditorToolNameV1 =
  | 'deleteClips'
  | 'executeKernelEditorTool'
  | 'getFramesAtTimes'
  | 'getTimelineState'
  | 'manageEditableHook'
  | 'refineEditableHook'
  | 'reorderClips'
  | 'splitClipAtTimes';

export type PublicTimelineStateFingerprintV1 = `sha256:${string}`;

export interface PublicTimelineFingerprintTrackV1 {
  id: string;
  type: 'audio' | 'midi' | 'video';
}

export interface PublicTimelineFingerprintClipV1 {
  duration: number;
  id: string;
  inPoint: number;
  linkedClipId?: string;
  outPoint: number;
  startTime: number;
  trackId: string;
}

export interface PublicTimelineFingerprintInputV1 {
  clips: readonly PublicTimelineFingerprintClipV1[];
  tracks: readonly PublicTimelineFingerprintTrackV1[];
}

export const PUBLIC_OPERATION_EFFECTS_V1: readonly PublicOperationEffectV1[] = [
  'mediaDuration',
  'segmentation',
  'sourceCoverage',
  'sourceOrder',
  'timelinePlacement',
];

export type PublicOperationArgumentFieldV1 =
  | {
      kind: 'boolean-v1';
      required: boolean;
    }
  | {
      kind: 'bounded-json-string-v1';
      maximumLength: number;
      minimumLength: number;
      required: boolean;
    }
  | {
      kind: 'finite-non-negative-number-v1';
      required: boolean;
    }
  | {
      kind: 'finite-number-array-v1';
      maximumItems: number;
      minimumItems: number;
      required: boolean;
      uniqueItems: true;
    }
  | {
      kind: 'non-empty-id-v1';
      maximumLength: number;
      minimumLength: number;
      required: boolean;
    }
  | {
      itemMaximumLength: number;
      itemMinimumLength: number;
      kind: 'non-empty-id-array-v1';
      maximumItems: number;
      minimumItems: number;
      required: boolean;
      uniqueItems: true;
    };

export interface PublicBindableResultV1 {
  path: readonly string[];
  selection: 'array-element-v1';
  value: 'non-empty-id-v1';
}

export interface PublicOperationSpecV1 {
  arguments: {
    additionalProperties: false;
    fields: Readonly<Record<string, PublicOperationArgumentFieldV1>>;
    schemaVersion: 1;
  };
  confirmation: 'inherit' | 'required';
  dispatcher: {
    adapterVersion: 'ms-kernel-ai-tool-dispatcher-v1';
    callerContext: 'kernel';
    suppressHistory: boolean;
    toolName: PublicEditorToolNameV1;
  };
  effects: readonly PublicOperationEffectV1[];
  id: PublicOperationIdV1;
  result: {
    bindable: readonly PublicBindableResultV1[];
    projection:
      | { kind: 'success-only-v1' }
      | {
          kind: 'bounded-json-v1';
          maximumCharacters: number;
        }
      | {
          idMaximumLength: number;
          kind: 'split-video-id-array-v1';
          maximumItems: number;
          minimumItems: number;
          uniqueItems: true;
        }
      | {
          frameTimes: 'echo-requested-times-v1';
          kind: 'visual-grid-v1';
          maximumDataUrlCharacters: number;
          maximumFrames: number;
        };
    schemaVersion: 1;
  };
  risk: 'destructive' | 'mutating' | 'read-only';
  transaction: 'none' | 'required';
}

/**
 * WP1 candidate fixture. This is deliberately structural: it has no model
 * descriptions, intent tags, selection heuristics, composition rules, prompt
 * text, recovery strategy, or verification rubric.
 */
export const PUBLIC_OPERATION_CONTRACT_V1 = {
  contractVersion: 'ms-editor-operations-v1',
  operations: [
    {
      arguments: {
        additionalProperties: false,
        fields: {},
        schemaVersion: 1,
      },
      confirmation: 'inherit',
      dispatcher: {
        adapterVersion: 'ms-kernel-ai-tool-dispatcher-v1',
        callerContext: 'kernel',
        suppressHistory: true,
        toolName: 'getTimelineState',
      },
      effects: [],
      id: 'timeline.editor.catalog.v1',
      result: {
        bindable: [],
        projection: { kind: 'success-only-v1' },
        schemaVersion: 1,
      },
      risk: 'read-only',
      transaction: 'none',
    },
    {
      arguments: {
        additionalProperties: false,
        fields: {
          requestJson: {
            kind: 'bounded-json-string-v1',
            maximumLength: 100_000,
            minimumLength: 2,
            required: true,
          },
        },
        schemaVersion: 1,
      },
      confirmation: 'required',
      dispatcher: {
        adapterVersion: 'ms-kernel-ai-tool-dispatcher-v1',
        callerContext: 'kernel',
        suppressHistory: false,
        toolName: 'executeKernelEditorTool',
      },
      effects: ['mediaDuration', 'segmentation', 'sourceCoverage', 'sourceOrder', 'timelinePlacement'],
      id: 'timeline.editor.destructive.v1',
      result: {
        bindable: [],
        projection: { kind: 'bounded-json-v1', maximumCharacters: 500_000 },
        schemaVersion: 1,
      },
      risk: 'destructive',
      transaction: 'none',
    },
    {
      arguments: {
        additionalProperties: false,
        fields: {
          requestJson: {
            kind: 'bounded-json-string-v1',
            maximumLength: 100_000,
            minimumLength: 2,
            required: true,
          },
        },
        schemaVersion: 1,
      },
      confirmation: 'inherit',
      dispatcher: {
        adapterVersion: 'ms-kernel-ai-tool-dispatcher-v1',
        callerContext: 'kernel',
        suppressHistory: false,
        toolName: 'executeKernelEditorTool',
      },
      effects: [],
      id: 'timeline.editor.inspect.v1',
      result: {
        bindable: [],
        projection: { kind: 'bounded-json-v1', maximumCharacters: 500_000 },
        schemaVersion: 1,
      },
      risk: 'read-only',
      transaction: 'none',
    },
    {
      arguments: {
        additionalProperties: false,
        fields: {
          requestJson: {
            kind: 'bounded-json-string-v1',
            maximumLength: 100_000,
            minimumLength: 2,
            required: true,
          },
        },
        schemaVersion: 1,
      },
      confirmation: 'inherit',
      dispatcher: {
        adapterVersion: 'ms-kernel-ai-tool-dispatcher-v1',
        callerContext: 'kernel',
        suppressHistory: false,
        toolName: 'executeKernelEditorTool',
      },
      effects: ['mediaDuration', 'segmentation', 'sourceCoverage', 'sourceOrder', 'timelinePlacement'],
      id: 'timeline.editor.mutate.v1',
      result: {
        bindable: [],
        projection: { kind: 'bounded-json-v1', maximumCharacters: 500_000 },
        schemaVersion: 1,
      },
      risk: 'mutating',
      transaction: 'none',
    },
    {
      arguments: {
        additionalProperties: false,
        fields: {
          requestJson: {
            kind: 'bounded-json-string-v1',
            maximumLength: 100_000,
            minimumLength: 2,
            required: true,
          },
        },
        schemaVersion: 1,
      },
      confirmation: 'inherit',
      dispatcher: {
        adapterVersion: 'ms-kernel-ai-tool-dispatcher-v1',
        callerContext: 'kernel',
        suppressHistory: false,
        toolName: 'executeKernelEditorTool',
      },
      effects: ['mediaDuration', 'segmentation', 'sourceCoverage', 'sourceOrder', 'timelinePlacement'],
      id: 'timeline.editor.program.commit.v1',
      result: {
        bindable: [],
        projection: { kind: 'bounded-json-v1', maximumCharacters: 500_000 },
        schemaVersion: 1,
      },
      risk: 'mutating',
      transaction: 'none',
    },
    {
      arguments: {
        additionalProperties: false,
        fields: {},
        schemaVersion: 1,
      },
      confirmation: 'inherit',
      dispatcher: {
        adapterVersion: 'ms-kernel-ai-tool-dispatcher-v1',
        callerContext: 'kernel',
        suppressHistory: true,
        toolName: 'getTimelineState',
      },
      effects: [],
      id: 'timeline.editor.program.preview.v1',
      result: {
        bindable: [],
        projection: { kind: 'success-only-v1' },
        schemaVersion: 1,
      },
      risk: 'read-only',
      transaction: 'none',
    },
    {
      arguments: {
        additionalProperties: false,
        fields: {
          requestJson: {
            kind: 'bounded-json-string-v1',
            maximumLength: 50_000,
            minimumLength: 2,
            required: true,
          },
        },
        schemaVersion: 1,
      },
      confirmation: 'inherit',
      dispatcher: {
        adapterVersion: 'ms-kernel-ai-tool-dispatcher-v1',
        callerContext: 'kernel',
        suppressHistory: true,
        toolName: 'refineEditableHook',
      },
      effects: ['mediaDuration', 'timelinePlacement'],
      id: 'timeline.hook.refine.commit.v1',
      result: {
        bindable: [],
        projection: { kind: 'success-only-v1' },
        schemaVersion: 1,
      },
      risk: 'mutating',
      transaction: 'none',
    },
    {
      arguments: {
        additionalProperties: false,
        fields: {
          requestJson: {
            kind: 'bounded-json-string-v1',
            maximumLength: 50_000,
            minimumLength: 2,
            required: true,
          },
        },
        schemaVersion: 1,
      },
      confirmation: 'inherit',
      dispatcher: {
        adapterVersion: 'ms-kernel-ai-tool-dispatcher-v1',
        callerContext: 'kernel',
        suppressHistory: true,
        toolName: 'manageEditableHook',
      },
      effects: ['mediaDuration', 'timelinePlacement'],
      id: 'timeline.hook.commit.v1',
      result: {
        bindable: [],
        projection: { kind: 'success-only-v1' },
        schemaVersion: 1,
      },
      risk: 'mutating',
      // This orchestration calls the existing async text and Motion builders.
      // They already perform the concrete editor mutations; wrapping their
      // awaited font/canvas preparation in the synchronous exclusive lease
      // would make the tool block its own continuation.
      transaction: 'none',
    },
    {
      arguments: {
        additionalProperties: false,
        fields: {},
        schemaVersion: 1,
      },
      confirmation: 'inherit',
      dispatcher: {
        adapterVersion: 'ms-kernel-ai-tool-dispatcher-v1',
        callerContext: 'kernel',
        suppressHistory: true,
        toolName: 'getTimelineState',
      },
      effects: [],
      id: 'timeline.hook.preview.v1',
      result: {
        bindable: [],
        projection: { kind: 'success-only-v1' },
        schemaVersion: 1,
      },
      risk: 'read-only',
      transaction: 'none',
    },
    {
      arguments: {
        additionalProperties: false,
        fields: {
          clipIds: {
            itemMaximumLength: 500,
            itemMinimumLength: 1,
            kind: 'non-empty-id-array-v1',
            maximumItems: 64,
            minimumItems: 2,
            required: true,
            uniqueItems: true,
          },
          startTime: { kind: 'finite-non-negative-number-v1', required: false },
          withLinked: { kind: 'boolean-v1', required: false },
        },
        schemaVersion: 1,
      },
      confirmation: 'required',
      dispatcher: {
        adapterVersion: 'ms-kernel-ai-tool-dispatcher-v1',
        callerContext: 'kernel',
        suppressHistory: true,
        toolName: 'reorderClips',
      },
      effects: ['sourceOrder', 'timelinePlacement'],
      id: 'timeline.intercut.commit.v1',
      result: {
        bindable: [],
        projection: { kind: 'success-only-v1' },
        schemaVersion: 1,
      },
      risk: 'mutating',
      transaction: 'required',
    },
    {
      arguments: {
        additionalProperties: false,
        fields: {},
        schemaVersion: 1,
      },
      confirmation: 'inherit',
      dispatcher: {
        adapterVersion: 'ms-kernel-ai-tool-dispatcher-v1',
        callerContext: 'kernel',
        suppressHistory: true,
        toolName: 'getTimelineState',
      },
      effects: [],
      id: 'timeline.intercut.preview.v1',
      result: {
        bindable: [],
        projection: { kind: 'success-only-v1' },
        schemaVersion: 1,
      },
      risk: 'read-only',
      transaction: 'none',
    },
    {
      arguments: {
        additionalProperties: false,
        fields: {
          clipIds: {
            itemMaximumLength: 500,
            itemMinimumLength: 1,
            kind: 'non-empty-id-array-v1',
            maximumItems: 200,
            minimumItems: 1,
            required: true,
            uniqueItems: true,
          },
          deClickFadeSeconds: {
            kind: 'finite-non-negative-number-v1',
            required: false,
          },
          withLinked: { kind: 'boolean-v1', required: false },
        },
        schemaVersion: 1,
      },
      confirmation: 'required',
      dispatcher: {
        adapterVersion: 'ms-kernel-ai-tool-dispatcher-v1',
        callerContext: 'kernel',
        suppressHistory: true,
        toolName: 'deleteClips',
      },
      effects: ['segmentation', 'sourceCoverage', 'mediaDuration'],
      id: 'timeline.segment.delete-many.v1',
      result: {
        bindable: [],
        projection: { kind: 'success-only-v1' },
        schemaVersion: 1,
      },
      risk: 'destructive',
      transaction: 'required',
    },
    {
      arguments: {
        additionalProperties: false,
        fields: {
          times: {
            kind: 'finite-number-array-v1',
            maximumItems: 8,
            minimumItems: 1,
            required: true,
            uniqueItems: true,
          },
        },
        schemaVersion: 1,
      },
      confirmation: 'inherit',
      dispatcher: {
        adapterVersion: 'ms-kernel-ai-tool-dispatcher-v1',
        callerContext: 'kernel',
        suppressHistory: true,
        toolName: 'getFramesAtTimes',
      },
      effects: [],
      id: 'timeline.visual.capture-grid.v1',
      result: {
        bindable: [],
        projection: {
          frameTimes: 'echo-requested-times-v1',
          kind: 'visual-grid-v1',
          maximumDataUrlCharacters: 8_000_000,
          maximumFrames: 8,
        },
        schemaVersion: 1,
      },
      risk: 'read-only',
      transaction: 'none',
    },
    {
      arguments: {
        additionalProperties: false,
        fields: {
          clipId: {
            kind: 'non-empty-id-v1',
            maximumLength: 500,
            minimumLength: 1,
            required: true,
          },
          times: {
            kind: 'finite-number-array-v1',
            maximumItems: 200,
            minimumItems: 1,
            required: true,
            uniqueItems: true,
          },
          snapToAudioZeroCrossing: { kind: 'boolean-v1', required: false },
          withLinked: { kind: 'boolean-v1', required: false },
        },
        schemaVersion: 1,
      },
      confirmation: 'inherit',
      dispatcher: {
        adapterVersion: 'ms-kernel-ai-tool-dispatcher-v1',
        callerContext: 'kernel',
        suppressHistory: true,
        toolName: 'splitClipAtTimes',
      },
      effects: ['segmentation'],
      id: 'timeline.segment.split.v1',
      result: {
        bindable: [{
          path: ['data', 'segments', 'videoClipIds'],
          selection: 'array-element-v1',
          value: 'non-empty-id-v1',
        }],
        projection: {
          idMaximumLength: 500,
          kind: 'split-video-id-array-v1',
          maximumItems: 201,
          minimumItems: 2,
          uniqueItems: true,
        },
        schemaVersion: 1,
      },
      risk: 'mutating',
      transaction: 'required',
    },
  ],
  schemaVersion: 1,
  stateFingerprint: {
    algorithm: 'sha256',
    canonicalClipFields: [
      'track-type-ordinal',
      'track-type',
      'start-time',
      'duration',
      'in-point',
      'out-point',
      'linked-canonical-index',
    ],
    excludedTrackTypes: ['midi'],
    linkEncoding: 'canonical-clip-index-or-minus-one-v1',
    numberPrecisionDecimalPlaces: 6,
    storeAssignedIdsExcluded: true,
    trackKey: 'type-ordinal-v1',
    version: 'ms-editor-timeline-state-fingerprint-v1',
  },
  validatorSemanticsVersion: 'ms-editor-structural-validator-v1',
} as const satisfies {
  contractVersion: 'ms-editor-operations-v1';
  operations: readonly PublicOperationSpecV1[];
  schemaVersion: 1;
  stateFingerprint: {
    algorithm: 'sha256';
    canonicalClipFields: readonly [
      'track-type-ordinal',
      'track-type',
      'start-time',
      'duration',
      'in-point',
      'out-point',
      'linked-canonical-index',
    ];
    excludedTrackTypes: readonly ['midi'];
    linkEncoding: 'canonical-clip-index-or-minus-one-v1';
    numberPrecisionDecimalPlaces: 6;
    storeAssignedIdsExcluded: true;
    trackKey: 'type-ordinal-v1';
    version: 'ms-editor-timeline-state-fingerprint-v1';
  };
  validatorSemanticsVersion: 'ms-editor-structural-validator-v1';
};

// Recomputed by the WP1 compatibility check from the canonical JSON above.
export const PUBLIC_OPERATION_CONTRACT_DIGEST_V1 =
  'sha256:75c941fa67c87e6f14f2933cec13499cbce5b0d5e164c004ec10b002d4c8baaa' as const;

export const PUBLIC_COMPILED_PLAN_EXTENSION_V1 = {
  bindingVersion: 'ms-prior-result-path-v1',
  maximumArgumentArrayLength: 256,
  maximumArgumentObjectKeys: 64,
  maximumBindingDepth: 8,
  maximumPathLength: 8,
  maximumSteps: 32,
  planVersion: 'ms-editor-compiled-plan-v1',
  resultPathPolicy: 'declared-array-element-only-v1',
} as const;

export const PUBLIC_COMPILED_PLAN_DIGEST_V1 =
  'sha256:fddab5db3c573719c9e8200bd343a89eca3175d96087d422e9a0d7bb1b6bdfa7' as const;

const OPERATION_BY_ID = new Map<PublicOperationIdV1, PublicOperationSpecV1>(
  PUBLIC_OPERATION_CONTRACT_V1.operations.map((operation) => [operation.id, operation]),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateArgumentField(
  value: unknown,
  field: PublicOperationArgumentFieldV1,
): boolean {
  if (field.kind === 'boolean-v1') return typeof value === 'boolean';
  if (field.kind === 'bounded-json-string-v1') {
    if (
      typeof value !== 'string'
      || value.length < field.minimumLength
      || value.length > field.maximumLength
    ) return false;
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
    } catch {
      return false;
    }
  }
  if (field.kind === 'finite-non-negative-number-v1') {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
  }
  if (field.kind === 'non-empty-id-v1') {
    return typeof value === 'string'
      && value.length >= field.minimumLength
      && value.length <= field.maximumLength;
  }
  if (!Array.isArray(value)
    || value.length < field.minimumItems
    || value.length > field.maximumItems
    || (field.uniqueItems && new Set(value).size !== value.length)) {
    return false;
  }
  if (field.kind === 'finite-number-array-v1') {
    return value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));
  }
  return value.every((entry) => (
    typeof entry === 'string'
    && entry.length >= field.itemMinimumLength
    && entry.length <= field.itemMaximumLength
  ));
}

export function canonicalPublicOperationContractV1(): string {
  return JSON.stringify(PUBLIC_OPERATION_CONTRACT_V1);
}

export function canonicalPublicCompiledPlanExtensionV1(): string {
  return JSON.stringify({
    operationContractDigest: PUBLIC_OPERATION_CONTRACT_DIGEST_V1,
    ...PUBLIC_COMPILED_PLAN_EXTENSION_V1,
  });
}

function roundFingerprintNumber(value: number): number {
  if (!Number.isFinite(value)) {
    throw new TypeError('timeline fingerprint contains a non-finite number');
  }
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function compareFingerprintStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Sanitized mechanical state form shared by Verified simulation parity tests.
 * Store-assigned ids are excluded; linked clips use their canonical position.
 */
export function canonicalPublicTimelineStateV1(
  input: PublicTimelineFingerprintInputV1,
): Array<[
  trackKey: string,
  type: 'audio' | 'video',
  startTime: number,
  duration: number,
  inPoint: number,
  outPoint: number,
  linkedIndex: number | null,
]> {
  const ordinalByType = new Map<string, number>();
  const trackKeyById = new Map<string, string>();
  const trackTypeById = new Map<string, PublicTimelineFingerprintTrackV1['type']>();
  for (const track of input.tracks) {
    if (
      typeof track.id !== 'string'
      || track.id.length === 0
      || !['audio', 'midi', 'video'].includes(track.type)
      || trackKeyById.has(track.id)
    ) {
      throw new TypeError('timeline fingerprint contains an invalid track');
    }
    const ordinal = ordinalByType.get(track.type) ?? 0;
    trackKeyById.set(track.id, `${track.type}:${ordinal}`);
    trackTypeById.set(track.id, track.type);
    ordinalByType.set(track.type, ordinal + 1);
  }

  const eligible = input.clips.filter((clip) => {
    const type = trackTypeById.get(clip.trackId);
    return type === 'audio' || type === 'video';
  });
  for (const clip of eligible) {
    if (
      typeof clip.id !== 'string'
      || clip.id.length === 0
      || typeof clip.trackId !== 'string'
      || clip.trackId.length === 0
      || (clip.linkedClipId !== undefined && typeof clip.linkedClipId !== 'string')
    ) {
      throw new TypeError('timeline fingerprint contains an invalid clip');
    }
    roundFingerprintNumber(clip.startTime);
    roundFingerprintNumber(clip.duration);
    roundFingerprintNumber(clip.inPoint);
    roundFingerprintNumber(clip.outPoint);
  }
  const ordered = [...eligible].sort((left, right) => {
    const leftTrack = trackKeyById.get(left.trackId) ?? left.trackId;
    const rightTrack = trackKeyById.get(right.trackId) ?? right.trackId;
    const leftType = trackTypeById.get(left.trackId) as 'audio' | 'video';
    const rightType = trackTypeById.get(right.trackId) as 'audio' | 'video';
    return compareFingerprintStrings(leftTrack, rightTrack)
      || left.startTime - right.startTime
      || compareFingerprintStrings(leftType, rightType)
      || left.duration - right.duration
      || left.inPoint - right.inPoint
      || left.outPoint - right.outPoint;
  });
  const indexById = new Map(ordered.map((clip, index) => [clip.id, index]));
  return ordered.map((clip) => {
    const type = trackTypeById.get(clip.trackId);
    if (type !== 'audio' && type !== 'video') {
      throw new TypeError('timeline fingerprint clip is bound to an unsupported track');
    }
    return [
      trackKeyById.get(clip.trackId) ?? clip.trackId,
      type,
      roundFingerprintNumber(clip.startTime),
      roundFingerprintNumber(clip.duration),
      roundFingerprintNumber(clip.inPoint),
      roundFingerprintNumber(clip.outPoint),
      clip.linkedClipId === undefined ? null : (indexById.get(clip.linkedClipId) ?? -1),
    ];
  });
}

export function isPublicTimelineStateFingerprintV1(
  value: unknown,
): value is PublicTimelineStateFingerprintV1 {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

export async function fingerprintPublicTimelineStateV1(
  input: PublicTimelineFingerprintInputV1,
): Promise<PublicTimelineStateFingerprintV1> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('SHA-256 is unavailable for the timeline state fingerprint');
  }
  const canonical = JSON.stringify(canonicalPublicTimelineStateV1(input));
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical),
  );
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hex}`;
}

export function getPublicOperationSpecV1(operationId: string): PublicOperationSpecV1 | undefined {
  return OPERATION_BY_ID.get(operationId as PublicOperationIdV1);
}

export function getPublicOperationDispatcherBindingV1(
  operationId: PublicOperationIdV1,
): PublicOperationSpecV1['dispatcher'] | undefined {
  return getPublicOperationSpecV1(operationId)?.dispatcher;
}

export function isAllowedPublicResultBindingV1(
  operationId: PublicOperationIdV1,
  path: readonly (number | string)[],
): boolean {
  const spec = getPublicOperationSpecV1(operationId);
  if (!spec) return false;
  return spec.result.bindable.some((binding) => (
    binding.selection === 'array-element-v1'
    && path.length === binding.path.length + 1
    && binding.path.every((entry, index) => path[index] === entry)
    && Number.isInteger(path.at(-1))
    && (path.at(-1) as number) >= 0
  ));
}

export function validatePublicOperationArgumentsV1(
  operationId: PublicOperationIdV1,
  value: unknown,
): value is Record<string, unknown> {
  if (!validatePublicOperationArgumentKeysV1(operationId, value)) return false;
  const spec = getPublicOperationSpecV1(operationId);
  if (!spec) return false;

  const fields = spec.arguments.fields;
  return Object.entries(fields).every(([key, field]) => {
    if (!Object.hasOwn(value, key) || value[key] === undefined) return !field.required;
    return validateArgumentField(value[key], field);
  });
}

export function validatePublicOperationArgumentKeysV1(
  operationId: PublicOperationIdV1,
  value: unknown,
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const spec = getPublicOperationSpecV1(operationId);
  if (!spec) return false;
  const fields = spec.arguments.fields;
  return !Object.keys(value).some((key) => !Object.hasOwn(fields, key))
    && Object.entries(fields).every(([key, field]) => (
      !field.required || (Object.hasOwn(value, key) && value[key] !== undefined)
    ));
}

export interface PublicOperationResultV1 {
  data?: unknown;
  error?: string;
  success: boolean;
}

function boundedOperationError(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return 'editor operation failed';
  return value.slice(0, 1_000);
}

function sanitizeBoundedEditorResult(
  value: unknown,
  depth = 0,
  budget: { nodes: number } = { nodes: 0 },
): unknown {
  budget.nodes += 1;
  if (budget.nodes > 20_000 || depth > 24) return '[result omitted: structural bound exceeded]';
  if (typeof value === 'string') {
    if (/^data:/i.test(value)) return '[binary data omitted]';
    return value.slice(0, 100_000);
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    return value.slice(0, 2_000).map((entry) => sanitizeBoundedEditorResult(entry, depth + 1, budget));
  }
  if (!isRecord(value)) return String(value);
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, entry] of Object.entries(value).slice(0, 500)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    output[key.slice(0, 200)] = sanitizeBoundedEditorResult(entry, depth + 1, budget);
  }
  return output;
}

export function projectPublicOperationResultV1(
  operationId: PublicOperationIdV1,
  value: unknown,
  operationArguments: Readonly<Record<string, unknown>>,
): PublicOperationResultV1 {
  if (!isRecord(value) || typeof value.success !== 'boolean') {
    return { success: false, error: 'editor operation returned an invalid result' };
  }
  if (!value.success) {
    return { success: false, error: boundedOperationError(value.error) };
  }

  const spec = getPublicOperationSpecV1(operationId);
  if (!spec) return { success: false, error: 'unknown editor operation result' };
  if (spec.result.projection.kind === 'success-only-v1') return { success: true };

  if (spec.result.projection.kind === 'bounded-json-v1') {
    if (value.data === undefined) return { success: true };
    const sanitized = sanitizeBoundedEditorResult(value.data);
    const serialized = JSON.stringify(sanitized);
    if (serialized.length <= spec.result.projection.maximumCharacters) {
      return { success: true, data: sanitized };
    }
    return {
      success: true,
      data: {
        preview: serialized.slice(0, spec.result.projection.maximumCharacters - 100),
        truncated: true,
      },
    };
  }

  if (spec.result.projection.kind === 'visual-grid-v1') {
    const data = value.data;
    const dataUrl = isRecord(data) ? data.dataUrl : undefined;
    const frameTimes = isRecord(data) ? data.frameTimes : undefined;
    const requestedTimes = operationArguments.times;
    if (
      typeof dataUrl !== 'string'
      || !dataUrl.startsWith('data:image/png;base64,')
      || dataUrl.length > spec.result.projection.maximumDataUrlCharacters
      || !Array.isArray(frameTimes)
      || !Array.isArray(requestedTimes)
      || frameTimes.length === 0
      || frameTimes.length > spec.result.projection.maximumFrames
      || frameTimes.some((time) => typeof time !== 'number' || !Number.isFinite(time))
      || new Set(frameTimes).size !== frameTimes.length
      || frameTimes.length !== requestedTimes.length
      || frameTimes.some((time, index) => time !== requestedTimes[index])
    ) {
      return { success: false, error: 'editor operation returned invalid visual evidence' };
    }
    return {
      success: true,
      data: { frameTimes: [...frameTimes], imageDataUrl: dataUrl },
    };
  }

  const data = value.data;
  const segments = isRecord(data) ? data.segments : undefined;
  const videoClipIds = isRecord(segments) ? segments.videoClipIds : undefined;
  const projection = spec.result.projection;
  if (
    !Array.isArray(videoClipIds)
    || videoClipIds.length < projection.minimumItems
    || videoClipIds.length > projection.maximumItems
    || (projection.uniqueItems && new Set(videoClipIds).size !== videoClipIds.length)
    || videoClipIds.some((id) => (
      typeof id !== 'string' || id.length === 0 || id.length > projection.idMaximumLength
    ))
  ) {
    return { success: false, error: 'editor operation returned invalid segment identities' };
  }
  return {
    success: true,
    data: { segments: { videoClipIds: [...videoClipIds] } },
  };
}
