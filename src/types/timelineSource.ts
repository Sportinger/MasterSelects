import type { VectorAnimationProvider } from './vectorAnimation';

export type TimelineSourceType =
  | 'video'
  | 'audio'
  | 'image'
  | 'text'
  | 'solid'
  | 'model'
  | 'camera'
  | 'light'
  | 'gaussian-avatar'
  | 'gaussian-splat'
  | 'splat-effector'
  | 'math-scene'
  | 'transition-overlay'
  | 'motion-shape'
  | 'motion-null'
  | 'motion-adjustment'
  | 'midi'
  | VectorAnimationProvider;
