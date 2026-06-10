export type FxWindowTarget =
  | { scope: 'track'; trackId: string; effectId?: string }
  | { scope: 'master'; effectId?: string };

export type TrackColorMenuTarget = {
  x: number;
  y: number;
  trackId: string;
};
