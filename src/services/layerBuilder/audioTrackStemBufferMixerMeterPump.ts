import {
  publishStemBufferMixerMeter,
  publishStemBufferMixerMeters,
} from './audioTrackStemBufferMixerSessions';
import {
  STEM_MIXER_METER_INTERVAL_MS,
  type StemBufferMixerSession,
} from './audioTrackStemSyncModel';

const stemBufferMixerPumpDebugState = {
  ensureCalls: 0,
  ensureSkippedExisting: 0,
  ensureSkippedNoWindow: 0,
  scheduledAt: 0,
  firedAt: 0,
  tickCount: 0,
  emptyTickCount: 0,
  publishTickCount: 0,
  lastKnownSessionCount: 0,
  timerActive: false,
  lastError: null as string | null,
  fallbackSinglePublishCount: 0,
};

export function getStemBufferMixerPumpDebugSnapshot() {
  return {
    ...stemBufferMixerPumpDebugState,
    scheduledAgeMs: stemBufferMixerPumpDebugState.scheduledAt > 0
      ? Math.round(performance.now() - stemBufferMixerPumpDebugState.scheduledAt)
      : null,
    firedAgeMs: stemBufferMixerPumpDebugState.firedAt > 0
      ? Math.round(performance.now() - stemBufferMixerPumpDebugState.firedAt)
      : null,
  };
}

export class StemBufferMixerMeterPump {
  private timerId: number | null = null;
  private readonly getSessions: () => ReadonlyMap<string, StemBufferMixerSession>;

  constructor(getSessions: () => ReadonlyMap<string, StemBufferMixerSession>) {
    this.getSessions = getSessions;
  }

  ensure(): void {
    const sessions = this.getSessions();
    stemBufferMixerPumpDebugState.ensureCalls += 1;
    stemBufferMixerPumpDebugState.lastKnownSessionCount = sessions.size;
    if (typeof window === 'undefined') {
      stemBufferMixerPumpDebugState.ensureSkippedNoWindow += 1;
      stemBufferMixerPumpDebugState.timerActive = false;
      return;
    }
    if (this.timerId !== null) {
      stemBufferMixerPumpDebugState.ensureSkippedExisting += 1;
      stemBufferMixerPumpDebugState.timerActive = true;
      return;
    }

    const tick = () => {
      const currentSessions = this.getSessions();
      stemBufferMixerPumpDebugState.firedAt = performance.now();
      stemBufferMixerPumpDebugState.tickCount += 1;
      this.timerId = null;
      stemBufferMixerPumpDebugState.timerActive = false;
      stemBufferMixerPumpDebugState.lastKnownSessionCount = currentSessions.size;
      if (currentSessions.size === 0) {
        stemBufferMixerPumpDebugState.emptyTickCount += 1;
        return;
      }
      stemBufferMixerPumpDebugState.publishTickCount += 1;
      try {
        publishStemBufferMixerMeters(currentSessions.values());
      } catch (error) {
        stemBufferMixerPumpDebugState.lastError = error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error);
        for (const session of currentSessions.values()) {
          publishStemBufferMixerMeter(session, true);
          stemBufferMixerPumpDebugState.fallbackSinglePublishCount += 1;
        }
      } finally {
        this.ensure();
      }
    };

    stemBufferMixerPumpDebugState.scheduledAt = performance.now();
    stemBufferMixerPumpDebugState.timerActive = true;
    this.timerId = window.setTimeout(tick, STEM_MIXER_METER_INTERVAL_MS);
  }

  stopIfIdle(): void {
    if (this.getSessions().size === 0) {
      this.stop();
    }
  }

  stop(): void {
    if (this.timerId === null || typeof window === 'undefined') return;
    window.clearTimeout(this.timerId);
    this.timerId = null;
    stemBufferMixerPumpDebugState.timerActive = false;
  }
}
