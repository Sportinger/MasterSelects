export const TIMELINE_EXTERNAL_DROP_MIME_TYPES = {
  composition: 'application/x-composition-id',
  text: 'application/x-text-item-id',
  solid: 'application/x-solid-item-id',
  mesh: 'application/x-mesh-item-id',
  camera: 'application/x-camera-item-id',
  light: 'application/x-light-item-id',
  splatEffector: 'application/x-splat-effector-item-id',
  mathScene: 'application/x-math-scene-item-id',
  motionShape: 'application/x-motion-shape-item-id',
  signalAsset: 'application/x-signal-asset-id',
  mediaFile: 'application/x-media-file-id',
} as const;

export type TimelineExternalDropCommandKind =
  | 'composition'
  | 'text'
  | 'solid'
  | 'mesh'
  | 'camera'
  | 'light'
  | 'splat-effector'
  | 'math-scene'
  | 'motion-shape'
  | 'signal-asset'
  | 'media-file'
  | 'external-files'
  | 'none';

export type TimelineExternalDropTrackType = 'video' | 'audio';

export interface TimelineExternalDropCommandInput {
  fileCount?: number;
  getData: (mimeType: string) => string;
  types: readonly string[];
}

export interface TimelineExternalDropCommand {
  kind: TimelineExternalDropCommandKind;
  itemId?: string;
  mimeType?: string;
}

const MIME_COMMAND_ORDER = [
  { kind: 'composition', mimeType: TIMELINE_EXTERNAL_DROP_MIME_TYPES.composition },
  { kind: 'text', mimeType: TIMELINE_EXTERNAL_DROP_MIME_TYPES.text },
  { kind: 'solid', mimeType: TIMELINE_EXTERNAL_DROP_MIME_TYPES.solid },
  { kind: 'mesh', mimeType: TIMELINE_EXTERNAL_DROP_MIME_TYPES.mesh },
  { kind: 'camera', mimeType: TIMELINE_EXTERNAL_DROP_MIME_TYPES.camera },
  { kind: 'light', mimeType: TIMELINE_EXTERNAL_DROP_MIME_TYPES.light },
  { kind: 'splat-effector', mimeType: TIMELINE_EXTERNAL_DROP_MIME_TYPES.splatEffector },
  { kind: 'math-scene', mimeType: TIMELINE_EXTERNAL_DROP_MIME_TYPES.mathScene },
  { kind: 'motion-shape', mimeType: TIMELINE_EXTERNAL_DROP_MIME_TYPES.motionShape },
  { kind: 'signal-asset', mimeType: TIMELINE_EXTERNAL_DROP_MIME_TYPES.signalAsset },
  { kind: 'media-file', mimeType: TIMELINE_EXTERNAL_DROP_MIME_TYPES.mediaFile },
] as const satisfies readonly {
  kind: Exclude<TimelineExternalDropCommandKind, 'external-files' | 'none'>;
  mimeType: string;
}[];

export function planTimelineExternalDropCommand(
  input: TimelineExternalDropCommandInput,
): TimelineExternalDropCommand {
  const typeSet = new Set(input.types);

  for (const entry of MIME_COMMAND_ORDER) {
    if (!typeSet.has(entry.mimeType)) {
      continue;
    }

    const itemId = input.getData(entry.mimeType);
    if (!itemId) {
      continue;
    }

    return {
      kind: entry.kind,
      itemId,
      mimeType: entry.mimeType,
    };
  }

  if ((input.fileCount ?? 0) > 0) {
    return { kind: 'external-files' };
  }

  return { kind: 'none' };
}

export function canRouteTimelineExternalDropCommandToTrack(
  command: TimelineExternalDropCommand,
  trackType: TimelineExternalDropTrackType,
): boolean {
  if (command.kind === 'none') {
    return false;
  }

  if (trackType === 'video') {
    return true;
  }

  return command.kind === 'media-file' || command.kind === 'external-files';
}
