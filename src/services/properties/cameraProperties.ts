import type { TimelineClip } from '../../types/timeline';
import type { PropertyDescriptor } from '../../types/propertyRegistry';
import { DEFAULT_SCENE_CAMERA_SETTINGS } from '../../stores/mediaStore/types';
import { DEFAULT_CAMERA_LENS } from '../../types/renderSettings';

const fields = [
  ['fov', 'Field of View', 1, 179, .1], ['near', 'Near Plane', .001, 1000, .001],
  ['far', 'Far Plane', .002, 100000, 1], ['resolutionWidth', 'Camera Width', 1, 16384, 1],
  ['resolutionHeight', 'Camera Height', 1, 16384, 1], ['exposure', 'Exposure', -16, 16, .01],
  ['fStop', 'f-Stop', 0, 64, .1], ['focusDistance', 'Focus Distance', 0, 100000, .001],
  ['shutterAngle', 'Shutter Angle', 0, 360, 1],
] as const;
const defaults = { ...DEFAULT_SCENE_CAMERA_SETTINGS, ...DEFAULT_CAMERA_LENS,
  resolutionWidth: DEFAULT_SCENE_CAMERA_SETTINGS.resolutionWidth ?? 1920,
  resolutionHeight: DEFAULT_SCENE_CAMERA_SETTINGS.resolutionHeight ?? 1080 };

/** Camera numeric controls use the same property/keyframe authoring path as Transform. */
export function getCameraDescriptorForPath(path: string, clip?: TimelineClip): PropertyDescriptor<number> | undefined {
  if (clip?.source?.type !== 'camera') return undefined;
  const field = fields.find(([key]) => path === `camera.${key}`);
  if (!field) return undefined;
  const [key, label, min, max, step] = field;
  const defaultValue = defaults[key];
  return { path, label, group: 'Camera', valueType: 'number', animatable: true, defaultValue,
    ui: { min, max, step },
    read: target => target.source?.cameraSettings?.[key] ?? defaultValue,
    write: (target, value) => {
      if (target.source?.type !== 'camera') return target;
      const numeric = typeof value === 'number' && Number.isFinite(value) ? value : defaultValue;
      return { ...target, source: { ...target.source, cameraSettings: { ...DEFAULT_SCENE_CAMERA_SETTINGS,
        ...target.source.cameraSettings, [key]: Math.max(min, Math.min(max, numeric)) } } };
    },
  };
}

export function getCameraDescriptorsForClip(clip: TimelineClip): PropertyDescriptor[] {
  return fields.flatMap(([key]) => { const d = getCameraDescriptorForPath(`camera.${key}`, clip); return d ? [d] : []; });
}
