export interface SetClipSpeedOptions {
  preservesPitch?: boolean;
}

export interface ClipSpeedActions {
  toggleClipReverse: (id: string) => void;
  setClipSpeed: (clipId: string, speed: number, options?: SetClipSpeedOptions) => boolean;
  setLinkedClipSpeedEnabled: (clipId: string, enabled: boolean) => boolean;
  setClipPreservesPitch: (clipId: string, preservesPitch: boolean) => void;
}
