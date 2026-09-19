import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { EngineStats } from '../../src/types/engineStats';
import { StatsOverlay } from '../../src/components/preview/StatsOverlay';

function createStats(fps: number, isIdle = false): EngineStats {
  return {
    fps,
    frameTime: 0,
    gpuMemory: 0,
    timing: { rafGap: 0, importTexture: 0, renderPass: 0, submit: 0, total: 0 },
    drops: { count: 0, lastSecond: 0, reason: 'none' },
    layerCount: 0,
    targetFps: 60,
    decoder: 'none',
    audio: { playing: 0, drift: 0, status: 'silent' },
    isIdle,
  };
}

function withSparsePlaybackSamples(stats: EngineStats, playbackRunStartedAt: number): EngineStats {
  return {
    ...stats,
    playbackRunStartedAt,
    playback: {
      frameEvents: 1,
      cadenceFps: 0,
      previewFrames: 1,
      previewUpdates: 1,
      previewRenderFps: 0,
      previewUpdateFps: 0,
    } as NonNullable<EngineStats['playback']>,
  };
}

describe('StatsOverlay', () => {
  it('shows only a neutral status dot and opens Stats when clicked', () => {
    const onOpen = vi.fn();
    const { rerender } = render(
      <StatsOverlay
        stats={createStats(60)}
        resolution={{ width: 1920, height: 1080 }}
        expanded={false}
        onToggle={onOpen}
      />,
    );

    const indicator = screen.getByRole('button', { name: 'Open Stats' });
    expect(indicator.textContent).toBe('');
    expect(indicator.firstElementChild).toHaveClass('preview-stats-dot');
    expect(indicator.firstElementChild).not.toHaveClass('preview-stats-dot-critical');

    fireEvent.click(indicator);
    expect(onOpen).toHaveBeenCalledOnce();

    fireEvent.mouseMove(indicator, { clientX: 100, clientY: 80 });
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('EFF 60');
    expect(tooltip).toHaveStyle({ left: '88px', top: '68px' });

    rerender(
      <StatsOverlay
        stats={createStats(20)}
        resolution={{ width: 1920, height: 1080 }}
        expanded={false}
        onToggle={onOpen}
      />,
    );
    expect(screen.getByRole('tooltip')).toHaveTextContent('EFF 20');

    fireEvent.mouseLeave(indicator);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it.each([
    { fps: 40, critical: false },
    { fps: 20, critical: true },
  ])('marks $fps effective FPS critical: $critical', ({ fps, critical }) => {
    render(
      <StatsOverlay
        stats={createStats(fps)}
        resolution={{ width: 1920, height: 1080 }}
        expanded={false}
      />,
    );

    const dot = screen.getByRole('button', { name: 'Open Stats' }).firstElementChild;
    if (critical) {
      expect(dot).toHaveClass('preview-stats-dot-critical');
    } else {
      expect(dot).not.toHaveClass('preview-stats-dot-critical');
    }
  });

  it('keeps idle neutral', () => {
    render(
      <StatsOverlay
        stats={createStats(0, true)}
        resolution={{ width: 1920, height: 1080 }}
        expanded={false}
      />,
    );

    const indicator = screen.getByRole('button', { name: 'Open Stats' });
    expect(indicator.textContent).toBe('');
    expect(indicator.firstElementChild).not.toHaveClass('preview-stats-dot-critical');
  });

  it('keeps sparse samples from a new playback run neutral', () => {
    render(
      <StatsOverlay
        stats={withSparsePlaybackSamples(createStats(30), performance.now())}
        resolution={{ width: 1920, height: 1080 }}
        expanded={false}
      />,
    );

    const indicator = screen.getByRole('button', { name: 'Open Stats' });
    expect(indicator.textContent).toBe('');
    expect(indicator.firstElementChild).not.toHaveClass('preview-stats-dot-critical');
  });

  it('reports a sustained sparse playback run as red after warmup', () => {
    render(
      <StatsOverlay
        stats={withSparsePlaybackSamples(createStats(30), performance.now() - 3_000)}
        resolution={{ width: 1920, height: 1080 }}
        expanded={false}
      />,
    );

    const indicator = screen.getByRole('button', { name: 'Open Stats' });
    expect(indicator.textContent).toBe('');
    expect(indicator.firstElementChild).toHaveClass('preview-stats-dot-critical');
  });

  it('uses recent cadence instead of a startup-depressed diagnostic window', () => {
    const stats = withSparsePlaybackSamples(createStats(30), performance.now() - 3_000);
    stats.targetFps = 30;
    stats.playback = {
      ...stats.playback!,
      previewFrames: 50,
      previewUpdates: 50,
      previewRenderFps: 16,
      previewUpdateFps: 16,
      recentCadence: {
        windowMs: 1_000,
        frameEvents: 0,
        cadenceFps: 0,
        previewFrames: 29,
        previewUpdates: 29,
        previewRenderFps: 29,
        previewUpdateFps: 29,
      },
    };

    render(
      <StatsOverlay
        stats={stats}
        resolution={{ width: 1920, height: 1080 }}
        expanded={false}
      />,
    );

    const indicator = screen.getByRole('button', { name: 'Open Stats' });
    expect(indicator.textContent).toBe('');
    expect(indicator.firstElementChild).not.toHaveClass('preview-stats-dot-critical');
  });
});
