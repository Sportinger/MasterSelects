import { FLOCK_PRESETS } from '../../../services/flock/presets/flockPresets';

export type TimelineEmptyContextMenuCommandKind =
  | 'paste-clips'
  | 'add-storyboard-scene'
  | 'add-caption-clip'
  | 'add-timeline-layer'
  | 'erase-gap'
  | 'erase-layer-gaps'
  | 'erase-all-gaps'
  | 'fit-comp-to-window';

export type TimelineAddLayerTarget =
  | 'text'
  | 'solid'
  | 'mesh-cube'
  | 'mesh-sphere'
  | 'mesh-plane'
  | 'mesh-cylinder'
  | 'mesh-torus'
  | 'mesh-cone'
  | 'text-3d'
  | 'camera'
  | 'light'
  | 'splat-effector'
  | 'motion-null'
  | 'motion-adjustment'
  | 'motion-rectangle'
  | 'motion-ellipse'
  | 'motion-polygon'
  | 'motion-star'
  | 'math-scene'
  | `flock:${string}`;

export type TimelineAddLayerGroup = 'core' | '3d' | 'motion' | 'generators' | 'special';

const FLOCK_LAYER_TARGET_PREFIX = 'flock:';

export function createFlockLayerTarget(presetId: string): TimelineAddLayerTarget {
  return `${FLOCK_LAYER_TARGET_PREFIX}${presetId}` as TimelineAddLayerTarget;
}

/** Preset id of a `flock:<presetId>` Add Layer target, or null for other targets. */
export function parseFlockLayerTarget(target: string): string | null {
  if (!target.startsWith(FLOCK_LAYER_TARGET_PREFIX)) return null;
  return target.slice(FLOCK_LAYER_TARGET_PREFIX.length) || null;
}

export interface TimelineEmptyContextMenuCommand {
  key: string;
  label: string;
  kind: TimelineEmptyContextMenuCommandKind;
  enabled?: boolean;
  group?: TimelineAddLayerGroup;
  payload?: {
    time: number;
    trackId: string;
    layerTarget?: TimelineAddLayerTarget;
  };
}

export interface TimelineEmptyContextMenuModel {
  clipboardCommands: TimelineEmptyContextMenuCommand[];
  sceneCommands: TimelineEmptyContextMenuCommand[];
  layerCommands: TimelineEmptyContextMenuCommand[];
  gapCommands: TimelineEmptyContextMenuCommand[];
  viewCommands: TimelineEmptyContextMenuCommand[];
}

export interface CreateTimelineEmptyContextMenuModelInput {
  time: number;
  trackId: string;
  trackType?: 'video' | 'audio' | 'midi';
  canPasteClips?: boolean;
}

export interface ExecuteTimelineEmptyContextMenuCommandInput {
  onPasteClips?: (time: number, trackId: string) => void;
  onEraseGap: (time: number, trackId: string) => void;
  onEraseLayerGaps: (time: number, trackId: string) => void;
  onEraseAllGaps: () => void;
  onFitCompToWindow: () => void;
  onAddStoryboardScene?: (time: number, trackId: string) => void;
  onAddCaptionClip?: (time: number, trackId: string) => void;
  onAddTimelineLayer?: (time: number, trackId: string, target: TimelineAddLayerTarget) => void;
}

const VIDEO_LAYER_COMMANDS: ReadonlyArray<{
  key: string;
  label: string;
  group: TimelineAddLayerGroup;
  target: TimelineAddLayerTarget;
}> = [
  { key: 'add-text-layer', label: 'Text', group: 'core', target: 'text' },
  { key: 'add-solid-layer', label: 'Solid', group: 'core', target: 'solid' },
  { key: 'add-mesh-cube', label: 'Cube', group: '3d', target: 'mesh-cube' },
  { key: 'add-mesh-sphere', label: 'Sphere', group: '3d', target: 'mesh-sphere' },
  { key: 'add-mesh-plane', label: 'Plane', group: '3d', target: 'mesh-plane' },
  { key: 'add-mesh-cylinder', label: 'Cylinder', group: '3d', target: 'mesh-cylinder' },
  { key: 'add-mesh-torus', label: 'Torus', group: '3d', target: 'mesh-torus' },
  { key: 'add-mesh-cone', label: 'Cone', group: '3d', target: 'mesh-cone' },
  { key: 'add-text-3d', label: '3D Text', group: '3d', target: 'text-3d' },
  { key: 'add-camera-layer', label: 'Camera', group: '3d', target: 'camera' },
  { key: 'add-light-layer', label: 'Light', group: '3d', target: 'light' },
  { key: 'add-splat-effector-layer', label: '3D Effector', group: '3d', target: 'splat-effector' },
  { key: 'add-motion-null', label: 'Motion Null', group: 'motion', target: 'motion-null' },
  { key: 'add-motion-adjustment', label: 'Adjustment Layer', group: 'motion', target: 'motion-adjustment' },
  { key: 'add-motion-rectangle', label: 'Rectangle', group: 'motion', target: 'motion-rectangle' },
  { key: 'add-motion-ellipse', label: 'Ellipse', group: 'motion', target: 'motion-ellipse' },
  { key: 'add-motion-polygon', label: 'Polygon', group: 'motion', target: 'motion-polygon' },
  { key: 'add-motion-star', label: 'Star', group: 'motion', target: 'motion-star' },
  { key: 'add-math-scene', label: 'Math Scene', group: 'special', target: 'math-scene' },
  ...FLOCK_PRESETS.map((preset) => ({
    key: `add-flock-${preset.id}`,
    label: `Flock: ${preset.label}`,
    group: 'generators' as const,
    target: createFlockLayerTarget(preset.id),
  })),
];

export function createTimelineEmptyContextMenuModel(
  input: CreateTimelineEmptyContextMenuModelInput,
): TimelineEmptyContextMenuModel {
  return {
    clipboardCommands: [
      {
        key: 'paste-clips',
        label: 'Paste',
        kind: 'paste-clips',
        enabled: input.canPasteClips === true,
        payload: { time: input.time, trackId: input.trackId },
      },
    ],
    sceneCommands: input.trackType === 'video'
      ? [
        {
          key: 'add-caption-clip',
          label: 'Add Caption Clip',
          kind: 'add-caption-clip',
          payload: { time: input.time, trackId: input.trackId },
        },
        {
          key: 'add-storyboard-scene',
          label: 'Add Scene Card',
          kind: 'add-storyboard-scene',
          payload: { time: input.time, trackId: input.trackId },
        },
      ]
      : [],
    layerCommands: input.trackType === 'video'
      ? VIDEO_LAYER_COMMANDS.map(command => ({
        key: command.key,
        label: command.label,
        kind: 'add-timeline-layer',
        group: command.group,
        payload: {
          time: input.time,
          trackId: input.trackId,
          layerTarget: command.target,
        },
      }))
      : [],
    gapCommands: [
      {
        key: 'erase-gap',
        label: 'Erase Space Between Clips',
        kind: 'erase-gap',
        payload: { time: input.time, trackId: input.trackId },
      },
      {
        key: 'erase-layer-gaps',
        label: 'Erase Space Between All Clips in This Layer',
        kind: 'erase-layer-gaps',
        payload: { time: input.time, trackId: input.trackId },
      },
      {
        key: 'erase-all-gaps',
        label: 'Erase Space Between All Clips',
        kind: 'erase-all-gaps',
      },
    ],
    viewCommands: [
      {
        key: 'fit-comp-to-window',
        label: 'Fit Comp to Window',
        kind: 'fit-comp-to-window',
      },
    ],
  };
}

export function executeTimelineEmptyContextMenuCommand(
  command: TimelineEmptyContextMenuCommand,
  input: ExecuteTimelineEmptyContextMenuCommandInput,
): boolean {
  if (command.enabled === false) return false;

  switch (command.kind) {
    case 'paste-clips':
      if (!command.payload || !input.onPasteClips) return false;
      input.onPasteClips(command.payload.time, command.payload.trackId);
      return true;
    case 'add-caption-clip':
      if (!command.payload || !input.onAddCaptionClip) return false;
      input.onAddCaptionClip(command.payload.time, command.payload.trackId);
      return true;
    case 'add-storyboard-scene':
      if (!command.payload || !input.onAddStoryboardScene) return false;
      input.onAddStoryboardScene(command.payload.time, command.payload.trackId);
      return true;
    case 'add-timeline-layer':
      if (!command.payload?.layerTarget || !input.onAddTimelineLayer) return false;
      input.onAddTimelineLayer(
        command.payload.time,
        command.payload.trackId,
        command.payload.layerTarget,
      );
      return true;
    case 'erase-gap':
      if (!command.payload) return false;
      input.onEraseGap(command.payload.time, command.payload.trackId);
      return true;
    case 'erase-layer-gaps':
      if (!command.payload) return false;
      input.onEraseLayerGaps(command.payload.time, command.payload.trackId);
      return true;
    case 'erase-all-gaps':
      input.onEraseAllGaps();
      return true;
    case 'fit-comp-to-window':
      input.onFitCompToWindow();
      return true;
    default:
      return false;
  }
}
