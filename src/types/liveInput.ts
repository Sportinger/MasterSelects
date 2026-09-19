export type LiveInputSource =
  | { kind: 'display'; displayLabel?: string }
  | { kind: 'video-device'; deviceId?: string; deviceLabel?: string }
  | { kind: 'composition-feedback'; compositionId: string };
