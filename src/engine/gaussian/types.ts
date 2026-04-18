import type { GaussianSplatSequenceData } from '../../types';

// Gaussian Splat Avatar types

/** ARKit 52 blendshape names for facial animation */
export const ARKIT_BLENDSHAPE_NAMES = [
  'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight',
  'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight',
  'eyeBlinkLeft', 'eyeBlinkRight', 'eyeLookDownLeft', 'eyeLookDownRight',
  'eyeLookInLeft', 'eyeLookInRight', 'eyeLookOutLeft', 'eyeLookOutRight',
  'eyeLookUpLeft', 'eyeLookUpRight', 'eyeSquintLeft', 'eyeSquintRight',
  'eyeWideLeft', 'eyeWideRight',
  'jawForward', 'jawLeft', 'jawOpen', 'jawRight',
  'mouthClose', 'mouthDimpleLeft', 'mouthDimpleRight', 'mouthFrownLeft', 'mouthFrownRight',
  'mouthFunnel', 'mouthLeft', 'mouthLowerDownLeft', 'mouthLowerDownRight',
  'mouthPressLeft', 'mouthPressRight', 'mouthPucker', 'mouthRight',
  'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower', 'mouthShrugUpper',
  'mouthSmileLeft', 'mouthSmileRight', 'mouthStretchLeft', 'mouthStretchRight',
  'mouthUpperUpLeft', 'mouthUpperUpRight', 'noseSneerLeft', 'noseSneerRight',
  'tongueOut',
] as const;

export type ARKitBlendshapeName = typeof ARKIT_BLENDSHAPE_NAMES[number];

/** Blendshape groups for UI organization */
export const BLENDSHAPE_GROUPS: Record<string, readonly ARKitBlendshapeName[]> = {
  'Brows': ['browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight'],
  'Eyes': ['eyeBlinkLeft', 'eyeBlinkRight', 'eyeLookDownLeft', 'eyeLookDownRight', 'eyeLookInLeft', 'eyeLookInRight', 'eyeLookOutLeft', 'eyeLookOutRight', 'eyeLookUpLeft', 'eyeLookUpRight', 'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight'],
  'Jaw': ['jawForward', 'jawLeft', 'jawOpen', 'jawRight'],
  'Mouth': ['mouthClose', 'mouthDimpleLeft', 'mouthDimpleRight', 'mouthFrownLeft', 'mouthFrownRight', 'mouthFunnel', 'mouthLeft', 'mouthLowerDownLeft', 'mouthLowerDownRight', 'mouthPressLeft', 'mouthPressRight', 'mouthPucker', 'mouthRight', 'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower', 'mouthShrugUpper', 'mouthSmileLeft', 'mouthSmileRight', 'mouthStretchLeft', 'mouthStretchRight', 'mouthUpperUpLeft', 'mouthUpperUpRight'],
  'Cheeks': ['cheekPuff', 'cheekSquintLeft', 'cheekSquintRight'],
  'Nose': ['noseSneerLeft', 'noseSneerRight'],
  'Tongue': ['tongueOut'],
};

/** Emotion presets — maps to blendshape values (0–1) */
export const EMOTION_PRESETS: Record<string, Record<string, number>> = {
  happy: { mouthSmileLeft: 0.8, mouthSmileRight: 0.8, cheekSquintLeft: 0.4, cheekSquintRight: 0.4 },
  sad: { browInnerUp: 0.7, mouthFrownLeft: 0.6, mouthFrownRight: 0.6, eyeSquintLeft: 0.3, eyeSquintRight: 0.3 },
  angry: { browDownLeft: 0.8, browDownRight: 0.8, mouthFrownLeft: 0.5, mouthFrownRight: 0.5, jawOpen: 0.2 },
  surprised: { browInnerUp: 0.9, eyeWideLeft: 0.8, eyeWideRight: 0.8, jawOpen: 0.5, mouthFunnel: 0.3 },
  neutral: {},
};

/** Data for a gaussian splat layer */
export interface GaussianLayerData {
  layerId: string;
  clipId: string;
  avatarUrl: string;
  blendshapes: Record<string, number>;
  opacity: number;
  position: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
}

/** Render settings for a gaussian-splat clip */
export interface GaussianSplatRenderSettings {
  useNativeRenderer: boolean;
  maxSplats: number;
  splatScale: number;
  orientationPreset?: 'default' | 'flip-x-180';
  nearPlane: number;
  farPlane: number;
  backgroundColor: string;
  sortFrequency: number;
}

export interface GaussianSplatTemporalSettings {
  enabled: boolean;
  playbackMode: 'loop' | 'clamp' | 'pingpong';
  sequenceFps: number;
  frameBlend: number;
}

export interface GaussianSplatParticleSettings {
  enabled: boolean;
  effectType: 'none' | 'explode' | 'drift' | 'swirl' | 'dissolve';
  intensity: number;
  speed: number;
  seed: number;
}

export interface GaussianSplatSettings {
  render: GaussianSplatRenderSettings;
  temporal: GaussianSplatTemporalSettings;
  particle: GaussianSplatParticleSettings;
}

export const DEFAULT_GAUSSIAN_SPLAT_SETTINGS: GaussianSplatSettings = {
  render: {
    useNativeRenderer: false,
    maxSplats: 0,
    splatScale: 1.0,
    orientationPreset: 'default',
    nearPlane: 1.0,
    farPlane: 1000,
    backgroundColor: 'transparent',
    sortFrequency: 1,
  },
  temporal: {
    enabled: false,
    playbackMode: 'loop',
    sequenceFps: 30,
    frameBlend: 0,
  },
  particle: {
    enabled: false,
    effectType: 'none',
    intensity: 0.5,
    speed: 1.0,
    seed: 42,
  },
};

function getGaussianSplatSourceFileName(
  fileName?: string,
  sequence?: GaussianSplatSequenceData,
): string | undefined {
  return sequence?.frames[0]?.name ?? fileName;
}

export function cloneGaussianSplatSettings(
  settings?: GaussianSplatSettings,
): GaussianSplatSettings {
  const base = settings ?? DEFAULT_GAUSSIAN_SPLAT_SETTINGS;
  return {
    render: {
      ...DEFAULT_GAUSSIAN_SPLAT_SETTINGS.render,
      ...base.render,
    },
    temporal: {
      ...DEFAULT_GAUSSIAN_SPLAT_SETTINGS.temporal,
      ...base.temporal,
    },
    particle: {
      ...DEFAULT_GAUSSIAN_SPLAT_SETTINGS.particle,
      ...base.particle,
    },
  };
}

export function shouldDefaultFlipGaussianSplatOrientation(
  options: {
    fileName?: string;
    sequence?: GaussianSplatSequenceData;
  },
): boolean {
  const resolvedFileName = getGaussianSplatSourceFileName(options.fileName, options.sequence);
  return !!resolvedFileName && /\.ply$/i.test(resolvedFileName);
}

export function resolveGaussianSplatSettingsForSource(
  settings: GaussianSplatSettings | undefined,
  options: {
    fileName?: string;
    sequence?: GaussianSplatSequenceData;
  },
): GaussianSplatSettings {
  const nextSettings = cloneGaussianSplatSettings(settings);
  if (
    settings?.render?.orientationPreset == null &&
    shouldDefaultFlipGaussianSplatOrientation(options)
  ) {
    nextSettings.render.orientationPreset = 'flip-x-180';
  }
  return nextSettings;
}
