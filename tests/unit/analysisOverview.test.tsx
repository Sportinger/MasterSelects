import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisOverviewTimeline } from '../../src/components/panels/properties/analysisWorkspace/AnalysisOverviewTimeline';
import { buildAnalysisOverviewLayout } from '../../src/components/panels/properties/analysisWorkspace/analysisOverviewBins';

vi.mock('../../src/components/timeline/utils/timelineCanvasPlatform', () => ({
  prefersSoftwareTimelineCanvas: () => true,
}));

function createContext(): CanvasRenderingContext2D {
  return {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    setTransform: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    roundRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 20 })),
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
    lineWidth: 1,
    lineJoin: 'round',
    lineCap: 'round',
    font: '',
    textAlign: 'left',
    textBaseline: 'middle',
  } as unknown as CanvasRenderingContext2D;
}

const analysis = {
  startTime: 100,
  duration: 10,
  lanes: {
    scenes: [
      { id: 'scene-a', start: 100, end: 104, label: 'Scene 1' },
      { id: 'scene-b', start: 104, end: 110, label: 'Scene 2' },
    ],
    cuts: [{ id: 'cut-1', start: 104, label: 'Cut' }],
    speech: [{ id: 'speech-a', start: 101, end: 103, label: 'Speaker 1', score: 0.92 }],
    people: [{ id: 'person-a', start: 101, end: 106, label: 'Person 1', score: 0.8 }],
    motion: [{ id: 'motion-a', start: 100, end: 105, label: 'Motion', score: 0.6 }],
    focus: [{ id: 'focus-a', start: 100, end: 110, label: 'Focus', score: 0.9 }],
    audio: [],
  },
};

/** Row geometry mirrored from the component's own layout to avoid magic Ys. */
const layout = buildAnalysisOverviewLayout(analysis.lanes, { graphHeight: 180 });

function rowCentreY(row: { top: number; height: number } | undefined): number {
  if (!row) throw new Error('expected layout row');
  return row.top + row.height / 2;
}

describe('AnalysisOverviewTimeline', () => {
  let getContext: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(createContext());
  });

  afterEach(() => {
    getContext.mockRestore();
  });

  it('maps keyboard, ARIA, and scene selection to the source-time window', () => {
    const onPlayheadChange = vi.fn();
    const onSceneClick = vi.fn();
    render(
      <AnalysisOverviewTimeline
        analysis={analysis}
        playheadTime={105}
        selectedSceneId="scene-a"
        width={400}
        onPlayheadChange={onPlayheadChange}
        onSceneClick={onSceneClick}
      />,
    );

    const slider = screen.getByRole('slider', { name: 'Analysis overview playhead' });
    expect(slider).toHaveAttribute('aria-valuemin', '100');
    expect(slider).toHaveAttribute('aria-valuemax', '110');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onPlayheadChange).toHaveBeenCalledWith(105.1);
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(onPlayheadChange).toHaveBeenCalledWith(100);

    const scene = screen.getByRole('button', { name: 'Scene 1' });
    expect(scene).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Scene 2' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(scene);
    expect(onSceneClick).toHaveBeenCalledWith(analysis.lanes.scenes[0]);
  });

  it('seeks on pointer down and keeps scrubbing while dragging', () => {
    const onPlayheadChange = vi.fn();
    render(
      <AnalysisOverviewTimeline
        analysis={analysis}
        playheadTime={100}
        width={400}
        onPlayheadChange={onPlayheadChange}
      />,
    );
    const slider = screen.getByRole('slider', { name: 'Analysis overview playhead' });

    fireEvent.pointerDown(slider, { clientX: 200, pointerId: 1 });
    expect(onPlayheadChange).toHaveBeenNthCalledWith(1, 105);
    fireEvent.pointerMove(slider, { clientX: 300, pointerId: 1 });
    expect(onPlayheadChange).toHaveBeenNthCalledWith(2, 107.5);
    fireEvent.pointerUp(slider, { pointerId: 1 });
    fireEvent.pointerMove(slider, { clientX: 320, pointerId: 1 });
    expect(onPlayheadChange).toHaveBeenCalledTimes(2);
  });

  it('inspects presence rows with label, time, and confidence', () => {
    const { container } = render(
      <AnalysisOverviewTimeline analysis={analysis} playheadTime={100} width={400} />,
    );
    const shell = container.querySelector('.AnalysisOverview__shell');
    expect(shell).not.toBeNull();

    const speechRow = layout.presence.find((row) => row.lane === 'speech');
    fireEvent.pointerMove(shell as Element, { clientX: 80, clientY: rowCentreY(speechRow) });
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Speech');
    expect(tooltip).toHaveTextContent('Speaker 1');
    expect(tooltip).toHaveTextContent('92%');
    expect(tooltip).toHaveTextContent('1:42');

    fireEvent.pointerLeave(shell as Element);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('reads all envelope metrics at once inside the shared plot', () => {
    const { container } = render(
      <AnalysisOverviewTimeline analysis={analysis} playheadTime={100} width={400} />,
    );
    const shell = container.querySelector('.AnalysisOverview__shell');

    fireEvent.pointerMove(shell as Element, { clientX: 80, clientY: rowCentreY(layout.metrics) });
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Frame metrics');
    expect(tooltip).toHaveTextContent('Motion');
    expect(tooltip).toHaveTextContent('60%');
    expect(tooltip).toHaveTextContent('Focus');
    expect(tooltip).toHaveTextContent('90%');
  });

  it('identifies cut needles at their exact source time', () => {
    const { container } = render(
      <AnalysisOverviewTimeline analysis={analysis} playheadTime={100} width={400} />,
    );
    const shell = container.querySelector('.AnalysisOverview__shell');

    fireEvent.pointerMove(shell as Element, { clientX: 160, clientY: rowCentreY(layout.cuts) });
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Cuts');
    expect(tooltip).toHaveTextContent('Cut');
    expect(tooltip).toHaveTextContent('1:44');
  });

  it('labels rows, legend, axis ticks, and signal coverage in plain language', () => {
    const { container } = render(
      <AnalysisOverviewTimeline analysis={analysis} playheadTime={102} width={400} />,
    );

    expect(screen.getByText('6/10 signals')).toBeInTheDocument();
    expect(screen.getByText('Scenes')).toBeInTheDocument();
    expect(screen.getByText('Cuts')).toBeInTheDocument();
    expect(screen.getByText('Speech')).toBeInTheDocument();
    expect(screen.getByText('People')).toBeInTheDocument();
    expect(screen.getByText('Motion')).toBeInTheDocument();
    expect(screen.getByText('Focus')).toBeInTheDocument();

    expect(screen.getByText('1:44')).toBeInTheDocument();
    expect(screen.getByText('1:48')).toBeInTheDocument();
    expect(screen.getByText('1:40')).toBeInTheDocument();
    expect(screen.getByText('1:50')).toBeInTheDocument();

    expect(screen.getByText('No data yet: Quality · Audio · Markers · Text')).toBeInTheDocument();
    expect(container.querySelector('.AnalysisOverview__srOnly'))
      .toHaveTextContent('Signals with data: Scenes (2)');
  });

  it('uses compact spacing in narrow panels and requests the software-safe context', () => {
    const { container } = render(
      <AnalysisOverviewTimeline analysis={analysis} playheadTime={102} width={300} />,
    );

    expect(container.querySelector('.AnalysisOverview--compact')).not.toBeNull();
    expect(screen.getByText('Speech')).toBeInTheDocument();
    expect(getContext).toHaveBeenCalledWith('2d', { willReadFrequently: true });
    const canvas = container.querySelector('canvas');
    expect(canvas?.width).toBeLessThanOrEqual(8192);
    expect(canvas?.height).toBeLessThanOrEqual(8192);
  });

  it('states the empty case honestly instead of drawing empty lanes', () => {
    render(
      <AnalysisOverviewTimeline
        analysis={{ startTime: 0, duration: 10, lanes: {} }}
        playheadTime={0}
        width={400}
      />,
    );

    expect(screen.getByText('0/10 signals')).toBeInTheDocument();
    expect(screen.getByText('No signals analysed yet')).toBeInTheDocument();
    expect(screen.queryByText(/No data yet:/)).toBeNull();
  });
});
