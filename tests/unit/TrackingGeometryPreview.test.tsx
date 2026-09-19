import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  TrackingGeometryPreview,
  collectTrackingGeometrySources,
  getTriangleSampleStep,
} from '../../src/components/preview/tracking/TrackingGeometryPreview';
import type { DenseTerrainMesh, TerrainReconstruction } from '../../src/types/terrainTracking';

function mesh(offset = 0): DenseTerrainMesh {
  return {
    positions: [offset, 0, 0, offset + 1, 0, 0, offset, 1, 0],
    indices: [0, 1, 2],
    origin: [offset, 0, 0],
    axisX: [1, 0, 0],
    axisY: [0, 1, 0],
    normal: [0, 0, 1],
    size: [1, 1],
  };
}

function terrain(denseMesh?: DenseTerrainMesh, patch?: DenseTerrainMesh): TerrainReconstruction {
  return {
    version: 1,
    solver: 'browser-sfm',
    denseMesh,
    footsteps: patch ? [{ id: 'patch-1', name: 'Patch', placement: { x: 0, y: 0, width: 1, height: 1, rotation: 0 }, mesh: patch }] : undefined,
    referenceTime: 0,
    intrinsics: { width: 1920, height: 1080, fx: 1, fy: 1, cx: 0, cy: 0 },
    cameras: [],
    vertices: [
      { position: [0, 0, 0], uvq: [0, 0, 1] },
      { position: [1, 0, 0], uvq: [1, 0, 1] },
      { position: [0, 1, 0], uvq: [0, 1, 1] },
    ],
    triangles: [0, 1, 2],
    sourceFrameCount: 1,
    sparsePointCount: 3,
    medianError: 0,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('TrackingGeometryPreview', () => {
  it('uses retained dense and patch arrays directly, deduplicates meshes, and falls back to sparse geometry', () => {
    const reconstruction = mesh();
    const patch = mesh(2);
    const sources = collectTrackingGeometrySources({
      ...terrain(reconstruction, patch),
      footsteps: [
        { id: 'one', name: 'One', placement: { x: 0, y: 0, width: 1, height: 1, rotation: 0 }, mesh: patch },
        { id: 'same', name: 'Same', placement: { x: 1, y: 0, width: 1, height: 1, rotation: 0 }, mesh: patch },
      ],
    });

    expect(sources).toHaveLength(2);
    expect(sources[0]!.positions).toBe(reconstruction.positions);
    expect(sources[1]!.positions).toBe(patch.positions);
    expect(collectTrackingGeometrySources(terrain())[0]).toMatchObject({ kind: 'sparse', indices: [0, 1, 2] });
    expect(getTriangleSampleStep(14_001 * 3)).toBe(2);
  });

  it('draws on demand and exposes keyboard controls without starting an animation loop', () => {
    const stroke = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      setTransform: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      stroke,
    } as unknown as CanvasRenderingContext2D);
    const animationFrame = vi.spyOn(window, 'requestAnimationFrame');

    render(<TrackingGeometryPreview terrain={terrain(mesh())} width={320} height={180} />);
    const preview = screen.getByRole('application');
    expect(screen.getByText(/coarse wireframe · no texture/)).toBeInTheDocument();
    expect(stroke).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(preview, { key: 'ArrowRight' });
    fireEvent.wheel(preview, { deltaY: -100 });
    expect(stroke.mock.calls.length).toBeGreaterThan(1);
    expect(animationFrame).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Reset tracking geometry view' }));
    expect(animationFrame).not.toHaveBeenCalled();
  });
});
