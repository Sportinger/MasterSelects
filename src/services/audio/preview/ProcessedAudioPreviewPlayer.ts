import type { LiveAudioRouteSettings } from '../audioGraphRouteSettings';
import { audioRoutingManager } from '../../audioRoutingManager';

interface Voice {
  source: AudioBufferSourceNode;
  key: string;
  offset: number;
  started: number;
  ended: boolean;
  scrub: boolean;
}

/** Already-rendered PCM runs at 1x, through the existing track/master node route. */
export class ProcessedAudioPreviewPlayer {
  private voices = new Map<string, Voice>();
  private readonly routing: typeof audioRoutingManager;
  constructor(routing = audioRoutingManager) { this.routing = routing; }
  has(id: string): boolean { return this.voices.has(id); }

  sync(id: string, key: string, buffer: AudioBuffer, local: number, playing: boolean,
    scrubbing: boolean, route: LiveAudioRouteSettings): boolean {
    if ((!playing && !scrubbing) || route.muted || local < 0 || local >= buffer.duration) {
      this.stop(id);
      return false;
    }
    const context = this.routing.ensureSharedContext();
    const existing = this.voices.get(id);
    const drift = existing ? local - (existing.offset + context.currentTime - existing.started) : Infinity;
    const scrubMoved = existing && Math.abs(local - existing.offset) > 0.005;
    const restart = !existing || existing.key !== key || existing.scrub !== scrubbing ||
      (scrubbing ? scrubMoved : existing.ended || Math.abs(drift) > 0.08);
    if (restart) {
      this.stop(id);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = 1;
      const voice: Voice = { source, key, offset: local, started: context.currentTime,
        ended: false, scrub: scrubbing };
      source.onended = () => { voice.ended = true; };
      this.voices.set(id, voice);
      this.routing.applyNodeEffects(this.routeId(id), source, route.volume,
        route.eqGains, route.pan, route.processors, route.master);
      // The processed buffer's clock is clip-local; never apply inPoint/speed twice.
      source.start(context.currentTime, local, scrubbing ? Math.min(0.08, buffer.duration - local) : undefined);
    } else if (existing) {
      this.routing.applyNodeEffects(this.routeId(id), existing.source, route.volume,
        route.eqGains, route.pan, route.processors, route.master);
    }
    return !this.voices.get(id)?.ended;
  }

  meter(id: string, now: number) { return this.routing.getNodeMeterSnapshot(this.routeId(id), now); }

  stop(id: string): void {
    const voice = this.voices.get(id);
    if (!voice) return;
    voice.source.onended = null;
    try { voice.source.stop(); } catch { /* Already ended. */ }
    voice.source.disconnect();
    this.routing.removeNodeRoute(this.routeId(id));
    this.voices.delete(id);
  }
  retain(ids: ReadonlySet<string>): void { for (const id of this.voices.keys()) if (!ids.has(id)) this.stop(id); }
  stopAll(): void { for (const id of this.voices.keys()) this.stop(id); }
  private routeId(id: string): string { return `processed-audio-preview:${id}`; }
}
