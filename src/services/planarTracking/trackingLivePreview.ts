import type { SurfaceSample } from '../../types/planarTracking';

export interface TrackingLiveFrame { clipId: string; trackId: string; pixels: ImageData; sample: SurfaceSample }
class TrackingLivePreview {
  frame: TrackingLiveFrame | null = null;
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.frame;
  show(frame: TrackingLiveFrame) { this.frame = frame; this.listeners.forEach(listener => listener()); }
  clear() { if (this.frame) { this.frame = null; this.listeners.forEach(listener => listener()); } }
}
// Image buffers are runtime-owned, never serialized into an editor/project store.
export const trackingLivePreview: TrackingLivePreview = import.meta.hot?.data?.trackingLivePreview ?? new TrackingLivePreview();
if (import.meta.hot) import.meta.hot.dispose(data => { data.trackingLivePreview = trackingLivePreview; });
