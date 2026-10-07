import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ExportFrameSamplingView } from '../../src/components/export/ExportFrameSamplingView';
afterEach(cleanup);
describe('export sample progress', () => {
  it.each([0, 1])('hides the sample row for an ordinary raster frame (%i)', count => {
    const { container } = render(<ExportFrameSamplingView sampling={{ stage: 'encoding', samples: count, targetSamples: count }} />);
    expect(container.childElementCount).toBe(0);
  });
  it('shows raster accumulation without advertising a denoise pass', () => {
    const { rerender } = render(<ExportFrameSamplingView sampling={{ stage: 'sampling', samples: 2, targetSamples: 4 }} />);
    expect(screen.getByText('Samples 2 / 4')).toBeTruthy(); expect(screen.queryByText('Denoise')).toBeNull();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');
    rerender(<ExportFrameSamplingView sampling={{ stage: 'encoding', samples: 4, targetSamples: 4 }} />);
    expect(screen.getByText('Samples 4 / 4')).toBeTruthy(); expect(screen.queryByText('Denoise')).toBeNull();
  });
  it('retains the requested denoise stage even with one path traced sample', () => {
    render(<ExportFrameSamplingView sampling={{ stage: 'denoising', samples: 1, targetSamples: 1, denoiseEnabled: true }} />);
    expect(screen.getByText('Denoise').className).toContain('active');
    expect(screen.getByText('Samples 1 / 1')).toBeTruthy();
  });
});
