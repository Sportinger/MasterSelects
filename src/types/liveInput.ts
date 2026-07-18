export type LiveInputSource =
  | { kind: 'display' }
  | { kind: 'video-device'; deviceId?: string; deviceLabel?: string }
  | { kind: 'composition-feedback'; compositionId: string };
