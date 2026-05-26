import { describe, expect, it } from 'vitest';
import {
  createClipAudioAnalysisJobState,
  updateClipAudioAnalysisJobState,
} from '../../../src/services/audio/clipAudioAnalysisJobs';

describe('clipAudioAnalysisJobs', () => {
  it('creates bounded semantic job state for timeline audio analysis', () => {
    const job = createClipAudioAnalysisJobState({
      kind: 'frequency-phase-analysis',
      label: 'Frequency/Phase',
      artifactKinds: ['frequency-summary', 'phase-correlation'],
      processed: true,
      now: '2026-05-25T10:00:00.000Z',
    });

    expect(job.jobId).toMatch(/^audio-analysis:frequency-phase-analysis:/);
    expect(job).toMatchObject({
      kind: 'frequency-phase-analysis',
      label: 'Frequency/Phase',
      artifactKinds: ['frequency-summary', 'phase-correlation'],
      processed: true,
      phase: 'queued',
      progress: 0,
      startedAt: '2026-05-25T10:00:00.000Z',
      updatedAt: '2026-05-25T10:00:00.000Z',
    });
  });

  it('updates phase, message, and clamps progress', () => {
    const job = createClipAudioAnalysisJobState({
      kind: 'spectrogram-tiles',
      label: 'Spectrogram',
      artifactKinds: ['spectrogram-tiles'],
      processed: false,
      now: '2026-05-25T10:00:00.000Z',
    });

    const updated = updateClipAudioAnalysisJobState(job, {
      phase: 'analyzing',
      progress: 120,
      message: 'Analyzing tiles',
      now: '2026-05-25T10:00:01.000Z',
    });

    expect(updated).toMatchObject({
      phase: 'analyzing',
      progress: 100,
      message: 'Analyzing tiles',
      updatedAt: '2026-05-25T10:00:01.000Z',
    });
    expect(updated.startedAt).toBe(job.startedAt);
  });
});
