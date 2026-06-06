import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildTimelineCanvasStoreDiagnostics,
  clearTimelineCanvasDiagnostics,
  getTimelineCanvasDiagnostics,
  reportTimelineCanvasDomDiagnostics,
  reportTimelineCanvasDrawDiagnostics,
  unregisterTimelineCanvasDrawDiagnostics,
  unregisterTimelineCanvasTrackDiagnostics,
} from '../../src/services/timeline/timelineCanvasDiagnostics';

describe('timeline canvas diagnostics', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearTimelineCanvasDiagnostics();
  });

  it('keeps current store tracks active across idle time and separates orphan diagnostics', () => {
    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValue(1_000);

    reportTimelineCanvasDrawDiagnostics('track-a', {
      inputClipCount: 120,
      visibleClipCount: 40,
      drawnClipCount: 35,
      thumbnailClipCount: 12,
      thumbnailDrawCount: 10,
      waveformClipCount: 4,
      workerMode: false,
    });
    reportTimelineCanvasDomDiagnostics('track-a', {
      domOverlayCount: 2,
      domClipBodyCount: 1,
      shellCount: 2,
      activeShellSlotCounts: { stem: 1 },
    });
    reportTimelineCanvasDrawDiagnostics('old-track', {
      inputClipCount: 20,
      visibleClipCount: 20,
      drawnClipCount: 20,
      thumbnailClipCount: 20,
      thumbnailDrawCount: 20,
      waveformClipCount: 0,
      workerMode: false,
    });

    nowSpy.mockReturnValue(61_500);
    const diagnostics = getTimelineCanvasDiagnostics(buildTimelineCanvasStoreDiagnostics({
      tracks: [{ id: 'track-a' }, { id: 'track-b' }],
      clips: Array.from({ length: 1447 }, (_, index) => ({
        trackId: index < 720 ? 'track-a' : 'track-b',
      })),
    })) as {
      totals: {
        trackCount: number;
        staleTrackCount: number;
        orphanedTrackCount: number;
        orphanedInputClipCount: number;
        reportedTrackCount: number;
        reportedInputClipCount: number;
        storeTrackCount: number;
        storeInputClipCount: number;
        missingTrackCount: number;
        missingTrackIds: string[];
        inputClipCount: number;
        domClipBodyCount: number;
        shellCount: number;
        activeShellSlotCounts: { stem?: number };
      };
      tracks: Array<{ trackId: string; isStale: boolean; ageMs: number }>;
      staleTracks: Array<{ trackId: string; isStale: boolean; ageMs: number }>;
      orphanedTracks: Array<{ trackId: string; isOrphaned: boolean; ageMs: number }>;
    };

    expect(diagnostics.totals.trackCount).toBe(1);
    expect(diagnostics.totals.staleTrackCount).toBe(0);
    expect(diagnostics.totals.orphanedTrackCount).toBe(1);
    expect(diagnostics.totals.orphanedInputClipCount).toBe(20);
    expect(diagnostics.totals.reportedTrackCount).toBe(2);
    expect(diagnostics.totals.reportedInputClipCount).toBe(140);
    expect(diagnostics.totals.storeTrackCount).toBe(2);
    expect(diagnostics.totals.storeInputClipCount).toBe(1447);
    expect(diagnostics.totals.missingTrackCount).toBe(1);
    expect(diagnostics.totals.missingTrackIds).toEqual(['track-b']);
    expect(diagnostics.totals.inputClipCount).toBe(120);
    expect(diagnostics.totals.domClipBodyCount).toBe(1);
    expect(diagnostics.totals.shellCount).toBe(2);
    expect(diagnostics.totals.activeShellSlotCounts.stem).toBe(1);
    expect(diagnostics.tracks[0]).toMatchObject({
      trackId: 'track-a',
      isStale: false,
      ageMs: 60500,
    });
    expect(diagnostics.staleTracks).toEqual([]);
    expect(diagnostics.orphanedTracks[0]).toMatchObject({
      trackId: 'old-track',
      isOrphaned: true,
      ageMs: 60500,
    });
  });

  it('removes renderer diagnostics on unregister instead of aging them into stale totals', () => {
    reportTimelineCanvasDrawDiagnostics('track-a', {
      inputClipCount: 12,
      visibleClipCount: 12,
      drawnClipCount: 12,
      thumbnailClipCount: 0,
      thumbnailDrawCount: 0,
      waveformClipCount: 0,
      workerMode: false,
    });
    reportTimelineCanvasDomDiagnostics('track-a', {
      domOverlayCount: 1,
      domClipBodyCount: 0,
      shellCount: 1,
      activeShellSlotCounts: { trim: 1 },
    });

    unregisterTimelineCanvasDrawDiagnostics('track-a');
    let diagnostics = getTimelineCanvasDiagnostics() as {
      totals: { trackCount: number; inputClipCount: number; shellCount: number };
    };

    expect(diagnostics.totals.trackCount).toBe(1);
    expect(diagnostics.totals.inputClipCount).toBe(0);
    expect(diagnostics.totals.shellCount).toBe(1);

    unregisterTimelineCanvasTrackDiagnostics('track-a');
    diagnostics = getTimelineCanvasDiagnostics() as {
      totals: { trackCount: number; reportedTrackCount: number };
      tracks: unknown[];
      staleTracks: unknown[];
    };

    expect(diagnostics.totals.trackCount).toBe(0);
    expect(diagnostics.totals.reportedTrackCount).toBe(0);
    expect(diagnostics.tracks).toEqual([]);
    expect(diagnostics.staleTracks).toEqual([]);
  });

  it('aggregates worker eligibility and fallback reasons', () => {
    reportTimelineCanvasDrawDiagnostics('worker-track', {
      inputClipCount: 4,
      visibleClipCount: 4,
      drawnClipCount: 4,
      thumbnailClipCount: 0,
      thumbnailDrawCount: 0,
      waveformClipCount: 0,
      workerMode: true,
      workerEligible: true,
      workerPendingDraw: false,
      workerDrawMs: 1.5,
      workerResourceBytes: 1024,
    });
    reportTimelineCanvasDrawDiagnostics('fallback-track', {
      inputClipCount: 2,
      visibleClipCount: 2,
      drawnClipCount: 2,
      thumbnailClipCount: 2,
      thumbnailDrawCount: 2,
      waveformClipCount: 0,
      workerMode: false,
      workerEligible: false,
      workerFallbackReasons: ['thumbnail-visuals', 'source-timing-visuals'],
      workerError: 'worker-runtime-error',
    });

    const diagnostics = getTimelineCanvasDiagnostics() as {
      totals: {
        workerTrackCount: number;
        workerEligibleTrackCount: number;
        workerFallbackTrackCount: number;
        workerFallbackReasons: Record<string, number>;
        workerDrawReportCount: number;
        workerDrawMsTotal: number;
        workerDrawMsMax: number;
        workerResourceBytes: number;
        workerErrorTrackCount: number;
        workerErrors: Record<string, number>;
      };
    };

    expect(diagnostics.totals.workerTrackCount).toBe(1);
    expect(diagnostics.totals.workerEligibleTrackCount).toBe(1);
    expect(diagnostics.totals.workerFallbackTrackCount).toBe(1);
    expect(diagnostics.totals.workerFallbackReasons).toEqual({
      'source-timing-visuals': 1,
      'thumbnail-visuals': 1,
    });
    expect(diagnostics.totals.workerDrawReportCount).toBe(1);
    expect(diagnostics.totals.workerDrawMsTotal).toBe(1.5);
    expect(diagnostics.totals.workerDrawMsMax).toBe(1.5);
    expect(diagnostics.totals.workerResourceBytes).toBe(1024);
    expect(diagnostics.totals.workerErrorTrackCount).toBe(1);
    expect(diagnostics.totals.workerErrors).toEqual({
      'worker-runtime-error': 1,
    });
  });
});
