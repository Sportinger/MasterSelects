export type SplatEffectorMode = 'repel' | 'attract' | 'swirl' | 'noise';

export interface SplatEffectorSettings {
  mode: SplatEffectorMode;
  strength: number;
  falloff: number;
  speed: number;
  seed: number;
}

export const DEFAULT_SPLAT_EFFECTOR_SETTINGS: SplatEffectorSettings = {
  mode: 'repel',
  strength: 20,
  falloff: 2,
  speed: 1,
  seed: 0,
};
