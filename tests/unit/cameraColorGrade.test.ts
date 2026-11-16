import { afterEach, describe, expect, it, vi } from 'vitest';

// The media store only matters here as the owner of the camera's shared grade.
const media = vi.hoisted(() => {
  let state = { files: [] as Array<Record<string, unknown>>, compositions: [] as unknown[], activeCompositionId: null as string | null };
  const store = {
    getState: () => state,
    setState: (patch: unknown) => { const next = typeof patch === 'function' ? (patch as (s: typeof state) => Partial<typeof state>)(state) : patch; state = { ...state, ...(next as object) }; },
  };
  return { store, reset: () => { state = { files: [], compositions: [], activeCompositionId: null }; } };
});
vi.mock('../../src/stores/mediaStore', () => ({ useMediaStore: media.store }));
const useMediaStore = media.store;
import { useTimelineStore } from '../../src/stores/timeline';
import { gradeWholeCamera, releaseCameraGrade, getCameraGradeStatus, cameraGradeForNewClip, cameraRuntimeGrade } from '../../src/services/colorGrades/cameraColorGrade';
import { createDefaultColorCorrectionState } from '../../src/types/colorCorrection';
import type { TimelineClip } from '../../src/types';

const piece = (id: string, mediaFileId: string, startTime: number) => ({
  id, trackId: 'v-totale', name: id, startTime, duration: 5, inPoint: startTime, outPoint: startTime + 5,
  mediaFileId, source: { type: 'video', mediaFileId }, transform: {}, effects: [],
}) as unknown as TimelineClip;

const initialTimeline = useTimelineStore.getState();
afterEach(() => { useTimelineStore.setState(initialTimeline, true); media.reset(); });

describe('camera grade', () => {
  it('grades every piece of the camera with one look, hands it to new pieces, and lets go again', () => {
    const graded = createDefaultColorCorrectionState();
    graded.enabled = true;
    const first = { ...piece('a', 'totale', 0), colorCorrection: graded };
    useMediaStore.setState({ files: [{ id: 'totale', name: 'Totale.MXF', type: 'video', parentId: null, createdAt: 1, file: new File(['x'], 'Totale.MXF'), url: 'blob:totale', duration: 100 } as never] });
    useTimelineStore.setState({ clips: [first, piece('b', 'totale', 10), piece('c', 'totale', 20), piece('x', 'jonas', 5)] });

    expect(getCameraGradeStatus(first, useTimelineStore.getState().clips)).toEqual({ mediaFileId: 'totale', total: 3, following: 0 });
    expect(gradeWholeCamera('a')).toBe(true);
    const clips = useTimelineStore.getState().clips;
    expect(clips.filter(c => c.mediaFileId === 'totale').every(c => c.colorGradeMode === 'remote')).toBe(true);
    expect(clips.find(c => c.id === 'x')!.colorGradeMode).toBeUndefined();
    expect(clips.find(c => c.id === 'b')!.colorCorrection!.activeVersionId).toBe(graded.activeVersionId);
    expect(useMediaStore.getState().files[0]!.remoteColorGrade).toBeDefined();

    // A new piece of that camera (a multicam switch) and its Multi Preview slot get the same look.
    expect(cameraGradeForNewClip('totale', clips)).toMatchObject({ colorGradeMode: 'remote' });
    expect(cameraGradeForNewClip('jonas', clips)).toBeNull();
    expect(cameraRuntimeGrade('jonas', clips)).toBeUndefined();

    expect(releaseCameraGrade('b')).toBe(true);
    const released = useTimelineStore.getState().clips;
    expect(released.filter(c => c.mediaFileId === 'totale').every(c => c.colorGradeMode === 'local')).toBe(true);
    expect(released.find(c => c.id === 'c')!.colorCorrection!.activeVersionId).toBe(graded.activeVersionId);
    expect(cameraGradeForNewClip('totale', released)).toBeNull();
  });
});
