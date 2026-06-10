// Deprecated audio facade. Live Web Audio ownership is centralized in
// audioRoutingManager; this module only preserves the old import surface.

import { audioRoutingManager } from './audioRoutingManager';
import type { AudioRouteEffectSettings } from './audio/audioGraphRouteSettings';

export {
  AudioStatusTracker,
  audioStatusTracker,
  type AudioStatus,
} from './audio/audioStatusTracker';

export interface EQBand {
  frequency: number;
  gain: number;
}

export const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

class AudioManager {
  private masterVolume = 1;
  private eqGains: number[] = EQ_FREQUENCIES.map(() => 0);

  async init(): Promise<void> {
    audioRoutingManager.ensureSharedContext();
  }

  connectMediaElement(element: HTMLMediaElement): void {
    void audioRoutingManager
      .applyEffects(element, 1, [], 0, [], this.getMasterRouteSettings())
      .then((routed) => {
        if (routed) {
          element.muted = false;
        }
      })
      .catch(() => undefined);
  }

  disconnectMediaElement(element: HTMLMediaElement): void {
    audioRoutingManager.removeRoute(element);
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));
  }

  setEQBand(bandIndex: number, gainDB: number): void {
    if (bandIndex < 0 || bandIndex >= this.eqGains.length) return;
    this.eqGains[bandIndex] = Math.max(-12, Math.min(12, gainDB));
  }

  getEQBands(): EQBand[] {
    return EQ_FREQUENCIES.map((frequency, index) => ({
      frequency,
      gain: this.eqGains[index],
    }));
  }

  setAllEQBands(gains: number[]): void {
    gains.forEach((gain, index) => this.setEQBand(index, gain));
  }

  resetEQ(): void {
    this.eqGains = EQ_FREQUENCIES.map(() => 0);
  }

  getMasterVolume(): number {
    const routingSnapshot = audioRoutingManager.getDebugSnapshot();
    const masterRoute = asRecord(routingSnapshot.masterRoute);
    return numberValue(masterRoute?.gain, this.masterVolume);
  }

  destroy(): void {
    audioRoutingManager.dispose();
  }

  isInitialized(): boolean {
    return audioRoutingManager.getActiveContext() !== null;
  }

  getCurrentTime(): number {
    return audioRoutingManager.getActiveContext()?.currentTime ?? 0;
  }

  getContext(): AudioContext | null {
    return audioRoutingManager.getActiveContext();
  }

  getMixerInput(): AudioNode | null {
    return null;
  }

  async resume(): Promise<void> {
    await audioRoutingManager.resumeContext();
  }

  getDebugSnapshot(): Record<string, unknown> {
    const routingSnapshot = audioRoutingManager.getDebugSnapshot();
    const masterRoute = asRecord(routingSnapshot.masterRoute);
    const routingEqGains = Array.isArray(masterRoute?.eqGains)
      ? [...masterRoute.eqGains]
      : [...this.eqGains];

    return {
      deprecated: true,
      owner: 'audioRoutingManager',
      initialized: routingSnapshot.context !== null,
      mediaElementSourceCount: numberValue(routingSnapshot.routeCount, 0),
      eqGains: routingEqGains,
      masterVolume: numberValue(masterRoute?.gain, this.masterVolume),
      context: routingSnapshot.context ?? null,
      routing: routingSnapshot,
    };
  }

  private getMasterRouteSettings(): AudioRouteEffectSettings {
    return {
      volume: this.masterVolume,
      eqGains: [...this.eqGains],
      processors: [],
    };
  }
}

let audioManagerInstance = import.meta.hot?.data?.audioManager as AudioManager | undefined;

audioManagerInstance ??= new AudioManager();

export const audioManager = audioManagerInstance;

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose((data) => {
    data.audioManager = audioManager;
  });
}
