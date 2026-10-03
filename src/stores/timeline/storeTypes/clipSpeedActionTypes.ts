export interface SetClipSpeedOptions {
  preservesPitch?: boolean;
}

export interface ClipSpeedActions {
  setClipTimeRemap: (clipId: string, timeRemap: import('../../../types/timeline').ClipTimeRemap | null) => boolean;
  freezeClipAtPlayhead: (clipId: string) => boolean;
  /** Enable Warp from the current visible mapping, or remove it. */
  toggleClipWarp: (clipId: string) => boolean;
  toggleClipReverse: (id: string) => void;
  setClipSpeed: (clipId: string, speed: number, options?: SetClipSpeedOptions) => boolean;
  setLinkedClipSpeedEnabled: (clipId: string, enabled: boolean) => boolean;
  setClipPreservesPitch: (clipId: string, preservesPitch: boolean) => void;
}
