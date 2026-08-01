import type { MotionJsonObject } from './jsonSafety';

export const MOTION_PRESET_FORMAT = 'masterselects.motion-preset' as const;
export const MOTION_PRESET_VERSION = 1 as const;

export type MotionPresetKind =
  | 'shape'
  | 'appearance'
  | 'graph-easing'
  | 'replicator';

export type MotionDependencyKind = 'media' | 'composition' | 'font';

export interface MotionContentDependency {
  readonly id: string;
  readonly kind: MotionDependencyKind;
  /** Project-local source id. Runtime handles and local paths are forbidden. */
  readonly sourceProjectId: string;
  readonly label?: string;
}

export interface MotionPresetEnvelopeV1 {
  readonly format: typeof MOTION_PRESET_FORMAT;
  readonly version: typeof MOTION_PRESET_VERSION;
  readonly scope: 'project-local';
  readonly presetId: string;
  readonly name: string;
  readonly kind: MotionPresetKind;
  readonly payload: MotionJsonObject;
  readonly dependencies: readonly MotionContentDependency[];
}

export const MOTION_PRESET_CODEC_ERROR_CODES = {
  MALFORMED_JSON: 'MD8_PRESET_MALFORMED_JSON',
  MALFORMED_ENVELOPE: 'MD8_PRESET_MALFORMED_ENVELOPE',
  UNKNOWN_VERSION: 'MD8_PRESET_UNKNOWN_VERSION',
  UNKNOWN_KIND: 'MD8_PRESET_UNKNOWN_KIND',
  DUPLICATE_DEPENDENCY: 'MD8_PRESET_DUPLICATE_DEPENDENCY',
  JSON_UNSAFE: 'MD8_PRESET_JSON_UNSAFE',
} as const;

export type MotionPresetCodecErrorCode =
  (typeof MOTION_PRESET_CODEC_ERROR_CODES)[keyof typeof MOTION_PRESET_CODEC_ERROR_CODES];

export interface MotionPresetCodecFailure {
  readonly code: MotionPresetCodecErrorCode;
  readonly path: string;
  readonly message: string;
}

export type MotionPresetCodecResult =
  | { readonly ok: true; readonly envelope: MotionPresetEnvelopeV1 }
  | { readonly ok: false; readonly failures: readonly MotionPresetCodecFailure[] };
