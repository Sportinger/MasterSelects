// Audio playback status tracker for stats display.

export interface AudioStatus {
  playing: number;
  drift: number;
  status: 'sync' | 'drift' | 'silent' | 'error';
}

export class AudioStatusTracker {
  private currentStatus: AudioStatus = {
    playing: 0,
    drift: 0,
    status: 'silent',
  };

  updateStatus(playing: number, maxDrift: number, hasError: boolean): void {
    this.currentStatus.playing = playing;
    this.currentStatus.drift = Math.round(maxDrift * 1000);

    if (hasError) {
      this.currentStatus.status = 'error';
    } else if (playing === 0) {
      this.currentStatus.status = 'silent';
    } else if (Math.abs(maxDrift) > 0.1) {
      this.currentStatus.status = 'drift';
    } else {
      this.currentStatus.status = 'sync';
    }
  }

  getStatus(): AudioStatus {
    return { ...this.currentStatus };
  }

  reset(): void {
    this.currentStatus = {
      playing: 0,
      drift: 0,
      status: 'silent',
    };
  }
}

let audioStatusTrackerInstance =
  import.meta.hot?.data?.audioStatusTracker as AudioStatusTracker | undefined;

audioStatusTrackerInstance ??= new AudioStatusTracker();

export const audioStatusTracker = audioStatusTrackerInstance;

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose((data) => {
    data.audioStatusTracker = audioStatusTracker;
  });
}
