import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  AnalysisSceneSparkline,
  type AnalysisSceneSparklineCurve,
} from '../../src/components/panels/properties/analysisWorkspace/AnalysisSceneSparkline';

function renderSparkline(
  values: readonly number[],
  start: number,
  end: number,
  curveOverrides?: Partial<AnalysisSceneSparklineCurve>,
) {
  return render(
    <AnalysisSceneSparkline
      curve={{
        values: new Float32Array(values),
        hopSeconds: 1,
        startSeconds: 0,
        ...curveOverrides,
      }}
      start={start}
      end={end}
    />,
  );
}

describe('AnalysisSceneSparkline', () => {
  it('slices points to the inclusive source-time range', () => {
    const { container } = renderSparkline([-60, -50, -40, -30, -20, -10, 0], 12, 15, { startSeconds: 10 });
    expect(container.querySelector('svg')).toHaveAttribute('data-point-count', '4');
    expect(container.querySelector('polyline')?.getAttribute('points')?.split(' ')).toHaveLength(4);
  });

  it('normalizes and clamps the fixed energy dB range', () => {
    const { container } = renderSparkline([-90, -60, 0, 12], 0, 3);
    const points = container.querySelector('polyline')?.getAttribute('points')?.split(' ') ?? [];
    expect(points.map(point => Number(point.split(',')[1]))).toEqual([16, 16, 0, 0]);
  });

  it('returns null for slices shorter than four points', () => {
    const { container } = renderSparkline([-60, -30, 0], 0, 2);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('downsamples long slices to at most one hundred points', () => {
    const values = Array.from({ length: 501 }, (_, index) => -60 + index / 10);
    const { container } = renderSparkline(values, 0, 500);
    expect(container.querySelector('svg')).toHaveAttribute('data-point-count', '100');
    expect(container.querySelector('polyline')?.getAttribute('points')?.split(' ')).toHaveLength(100);
  });
});
