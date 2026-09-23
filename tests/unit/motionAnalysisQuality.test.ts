import { describe, expect, it, vi } from 'vitest';
import { motionAnalysisMaxEdge } from '../../src/effects/time/motionAnalysisQuality';

const state = vi.hoisted(() => ({ isPlaying: false, isDraggingPlayhead: false, exporting: false }));
vi.mock('../../src/stores/timeline', () => ({ useTimelineStore: { getState: () => state } }));
vi.mock('../../src/effects/time/temporalResourcePreparation', () => ({ isCollectingTemporalPreparations: () => state.exporting }));

describe('motion analysis presentation quality', () => {
  it('uses a smaller field for playback/scrubbing and restores full analysis on pause', () => {
    state.isPlaying = true;
    expect(motionAnalysisMaxEdge()).toBe(80);
    state.isPlaying = false; state.isDraggingPlayhead = true;
    expect(motionAnalysisMaxEdge()).toBe(80);
    state.isDraggingPlayhead = false;
    expect(motionAnalysisMaxEdge()).toBe(320);
  });
  it('keeps full analysis during export even while the timeline is playing', () => {
    state.exporting = true; state.isPlaying = true;
    expect(motionAnalysisMaxEdge()).toBe(320);
    state.exporting = false; state.isPlaying = false;
  });
});
