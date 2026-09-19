import { createTimelineClipsHistorySignature } from '../../src/hooks/historyContentSignatures';
import type { TimelineClip } from '../../src/types/timeline';
import { describe, expect, it } from 'vitest';
import { clonePlanarTracks } from '../../src/services/planarTracking/clonePlanarTracks';
import { cloneHistoryPlainData, findHistoryStateBoundaryViolations } from '../../src/stores/timeline/historyTimelineEditState';
import type { PlanarTrack } from '../../src/types/planarTracking';
import type { DenseTerrainMesh } from '../../src/types/terrainTracking';

function fixture() {
  const mesh: DenseTerrainMesh = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2],
    origin: [0, 0, 0], axisX: [1, 0, 0], axisY: [0, 1, 0], normal: [0, 0, 1], size: [1, 1] };
  const track = { id: 'disabled-surface', enabled: false, terrain: { denseMesh: mesh,
    cameras: [{ time: 0 }], footsteps: [{ id: 'left', placement: { x: 1 }, mesh }] } } as unknown as PlanarTrack;
  return { mesh, track };
}

describe('terrain geometry across save and undo snapshots', () => {
  it('shares immutable geometry across repeated snapshots while isolating edits', () => {
    const { mesh, track } = fixture();
    const serialized = clonePlanarTracks([track])!;
    const snapshots = Array.from({ length: 25 }, () => cloneHistoryPlainData({ planarTracks: serialized }));
    for (const snapshot of snapshots) {
      expect(snapshot.planarTracks[0].terrain!.denseMesh).toBe(mesh);
      expect(snapshot.planarTracks[0].terrain!.footsteps![0].mesh).toBe(mesh);
    }
    snapshots[0].planarTracks[0].terrain!.footsteps![0].placement.x = 99;
    expect(snapshots[1].planarTracks[0].terrain!.footsteps![0].placement.x).toBe(1);
    expect(track.terrain!.footsteps![0].placement.x).toBe(1);
    expect(Object.isFrozen(mesh.positions)).toBe(true);
    expect(JSON.parse(JSON.stringify(snapshots[0])).planarTracks[0].terrain.denseMesh.positions).toEqual(mesh.positions);
  });

  it('keeps history signatures compact while detecting placement and geometry edits', () => {
    const { track } = fixture();
    const clips = [{ id: 'clip', planarTracks: clonePlanarTracks([track]) }] as TimelineClip[];
    const original = createTimelineClipsHistorySignature(clips);
    expect(original.length).toBeLessThan(500);
    expect(createTimelineClipsHistorySignature(clips)).toBe(original);
    clips[0].planarTracks![0].terrain!.footsteps![0].placement.x = 4;
    expect(createTimelineClipsHistorySignature(clips)).not.toBe(original);
    const edited = createTimelineClipsHistorySignature(clips);
    clips[0].planarTracks = clonePlanarTracks([fixture().track]);
    expect(createTimelineClipsHistorySignature(clips)).not.toBe(edited);
  });

  it('still rejects invalid numeric mesh data before caching validation', () => {
    const { mesh, track } = fixture();
    mesh.positions[0] = NaN;
    const tracks = clonePlanarTracks([track]);
    expect(() => cloneHistoryPlainData(tracks)).toThrow('non-finite');
    expect(findHistoryStateBoundaryViolations(tracks).length).toBeGreaterThan(0);
  });
});
