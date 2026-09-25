import { useMediaStore } from '../../../stores/mediaStore';
import { ResidentTemporalRuntime } from '../ResidentTemporalRuntime';
import { useTimelineStore } from '../../../stores/timeline';
import type { TemporalClipSource } from '../temporalClipSource';
import { isCollectingTemporalPreparations, setTemporalStatus } from '../temporalResourcePreparation';
import { timeStackSettings } from './settings';

/** One bounded source cache per stack; all samples share its atlas and decoder lease. */
export class TimeStackResources {
  private runtime: ResidentTemporalRuntime;
  private owners = new Map<string, { scope: string; effectId: string }>();
  constructor(device: GPUDevice, onReady?: () => void) { this.runtime = new ResidentTemporalRuntime(device, onReady); }

  retain(scope: string, effectIds: ReadonlySet<string>) {
    for (const [key, owner] of this.owners) if (owner.scope === scope && !effectIds.has(owner.effectId)) {
      this.runtime.release(key); this.owners.delete(key); setTemporalStatus(owner.effectId, '');
    }
  }

  resolve(effect: { id: string; params: Record<string, unknown> }, scope: string, source: TemporalClipSource | undefined,
    encoder: GPUCommandEncoder, currentInput: { view: GPUTextureView; width: number; height: number }) {
    if (!source) throw new Error('Time Stack requires a video source clip.');
    const media = useMediaStore.getState().files.find(file => file.id === source.mediaId);
    if (!media || media.type !== 'video') throw new Error('Time Stack source video is unavailable.');
    const settings = timeStackSettings(effect.params, source.localTime);
    const key = JSON.stringify([scope, effect.id]);
    this.owners.set(key, { scope, effectId: effect.id });
    const exporting = isCollectingTemporalPreparations();
    const horizon = (settings.count - 1) * settings.offset;
    const speed = Math.max(1, Math.abs(source.speed), ...source.speedKeyframes.map(key => Math.abs(Number(key.value)) || 1));
    const reserveFrames = Math.ceil((horizon + 0.5) * (media.fps || 30) * speed);
    const memoryMiB = ['640', '1024', '2048', '4096'].includes(String(effect.params.memoryMiB)) ? Number(effect.params.memoryMiB) : 1024;
    const history = this.runtime.resolve({ key, effectId: effect.id, media, source, encoder, currentInput,
      delays: settings.delays, horizon: settings.delays.at(-1) ?? 0, samples: settings.activeCount,
      nearest: true, completeWindow: true, reserveFrames: settings.offset > 0 ? reserveFrames : 1,
      keepPending: !exporting && useTimelineStore.getState().isPlaying,
      maxEdge: !exporting && effect.params.previewSize === 'small' ? 960 : undefined,
    }, memoryMiB);
    return history ? { ...history, queries: undefined } : undefined;
  }

  destroy() { this.runtime.destroy(); this.owners.clear(); }
}
