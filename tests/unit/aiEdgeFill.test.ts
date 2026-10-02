import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Effect } from '../../src/types/effects';
import { edgeFillSource } from '../../src/effects/distort/ai-edge-fill/edgeFillSource';
const mocks = vi.hoisted(() => ({ create: vi.fn(), poll: vi.fn(), save: vi.fn(), capture: vi.fn(), getState: vi.fn(), journal: vi.fn(), readJournal: vi.fn(), preview: vi.fn(), reference: vi.fn(), getHandle: vi.fn(), start: vi.fn(), end: vi.fn() }));
vi.mock('../../src/services/cloudAiService', () => ({ cloudAiService: { createTextToImage: mocks.create, pollTaskUntilComplete: mocks.poll } }));
vi.mock('../../src/services/rawImage/guidedPhotoPreview', () => ({ createGuidedPhotoPreview: mocks.preview }));
vi.mock('../../src/effects/distort/ai-edge-fill/edgeFillReference', () => ({ edgeFillReference: mocks.reference }));
vi.mock('../../src/stores/mediaStore', () => ({ useMediaStore: { getState: () => ({ activeCompositionId: 'comp', compositions: [{ id: 'comp', width: 300, height: 200 }] }) } }));
vi.mock('../../src/stores/timeline', () => ({ useTimelineStore: { getState: mocks.getState } }));
vi.mock('../../src/stores/historyStore', () => ({ startBatch: mocks.start, endBatch: mocks.end }));
vi.mock('../../src/services/project/domains/ArtifactService', () => ({ artifactService: {} }));
vi.mock('../../src/services/project/ProjectFileService', () => ({ projectFileService: { getProjectHandle: mocks.getHandle } }));
vi.mock('../../src/services/project/repository/artifacts/RepositoryDomainPublication', () => ({ captureRepositoryDomainPublication: mocks.capture }));
vi.mock('../../src/effects/distort/ai-edge-fill/edgeFillArtifacts', () => ({ edgeFillArtifacts: { save: mocks.save, get: () => null } }));
import { edgeFillJob, generateEdgeFill } from '../../src/effects/distort/ai-edge-fill/edgeFillGeneration';
import { aiEdgeFill } from '../../src/effects/distort/ai-edge-fill';
const fill = (): Effect => ({ id: 'fill', type: 'ai-edge-fill', name: 'Fill', enabled: true, params: { prompt: 'Continue the room', resolution: '2K', taskId: '' } });
const lens = (): Effect => ({ id: 'lens', type: 'lens-correction', name: 'Lens', enabled: true, params: { distortion: 20, scale: 100 } });
const file = new File(['original'], 'photo.CR2', { lastModified: 123 });
let serial = 0, hasHoles = true;
const transform = { position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: { x: 0, y: 0, z: 0 }, anchor: { x: 0, y: 0, z: 0 }, opacity: 1, blendMode: 'normal' };
let state: { clips: Array<{ id: string; file: File; transform: typeof transform; source: { type: string }; effects: Effect[] }>; clipKeyframes: Map<string, Array<{ property: string; value: number }>>; updateClipEffect: ReturnType<typeof vi.fn> };
let publication: { repositoryId: string; sessionEpoch: string; artifacts: object; appendJournal: typeof mocks.journal; readJournal: typeof mocks.readJournal };
beforeEach(() => {
  vi.clearAllMocks(); hasHoles = true;
  state = { clips: [{ id: `photo-${++serial}`, file, transform: structuredClone(transform), source: { type: 'image' }, effects: [lens(), fill()] }], clipKeyframes: new Map(), updateClipEffect: vi.fn((clipId, effectId, patch) => {
    const effect = state.clips.find(clip => clip.id === clipId)!.effects.find(item => item.id === effectId)!;
    effect.params = { ...effect.params, ...patch };
  }) };
  publication = { repositoryId: 'project', sessionEpoch: 'epoch', artifacts: {}, appendJournal: mocks.journal, readJournal: mocks.readJournal };
  mocks.getState.mockImplementation(() => state); mocks.capture.mockImplementation(() => publication);
  mocks.getHandle.mockReturnValue(null); mocks.readJournal.mockResolvedValue(null); mocks.journal.mockResolvedValue(undefined);
  mocks.preview.mockResolvedValue({ blob: new Blob(['preview'], { type: 'image/png' }), aspect: 1.5, sourceWidth: 300, sourceHeight: 200 });
  mocks.reference.mockImplementation(async () => { if (!hasHoles) throw new Error('No transparent borders'); return ['data:image/png;photo', 'data:image/png;mask']; });
  mocks.create.mockResolvedValue('task-1'); mocks.poll.mockResolvedValue({ status: 'completed', imageUrl: '/api/fill' });
  mocks.save.mockResolvedValue('artifact:fill');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['fill']) }));
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 2, height: 2, close: vi.fn() }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ drawImage: vi.fn(), fillRect: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray(hasHoles ? [80, 90, 100, 255, 0, 0, 0, 0] : [0, 0, 0, 255]) }),
  }) as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['png'], { type: 'image/png' })));
});
describe('AI edge fill lifecycle', () => {
  it('does not charge for an opaque photo or unsupported preceding effects', async () => {
    hasHoles = false;
    await generateEdgeFill(state.clips[0].id, 'fill');
    expect(mocks.create).not.toHaveBeenCalled(); expect(edgeFillJob(state.clips[0].id, 'fill').error).toContain('No transparent borders');
    state.clips[0].effects.unshift({ ...lens(), type: 'blur' });
    await generateEdgeFill(state.clips[0].id, 'fill'); expect(mocks.create).not.toHaveBeenCalled();
  });
  it('generates once, stores an artifact and preserves the original file', async () => {
    await generateEdgeFill(state.clips[0].id, 'fill');
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ provider: 'nano-banana-pro', prompt: 'Continue the room', imageInputs: ['data:image/png;photo', 'data:image/png;mask'], resolution: '2K' }), expect.stringContaining('edge-fill:'));
    expect(mocks.journal.mock.calls[0][1]).toHaveProperty('requestId');
    expect(mocks.save).toHaveBeenCalledWith(expect.any(Blob), publication.artifacts, expect.any(String), 1.5);
    expect(state.clips[0].effects[1].params).toMatchObject({ artifactId: 'artifact:fill', taskId: '', requestId: '' });
    expect(state.clips[0].file).toBe(file); expect(mocks.start).toHaveBeenCalledTimes(1); expect(mocks.end).toHaveBeenCalledTimes(1);
  });
  it('resumes a failed download without submitting another generation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await generateEdgeFill(state.clips[0].id, 'fill'); expect(state.clips[0].effects[1].params.taskId).toBe('task-1');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['fill']) }));
    await generateEdgeFill(state.clips[0].id, 'fill');
    expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.poll).toHaveBeenCalledTimes(2);
    expect(state.clips[0].effects[1].params.artifactId).toBe('artifact:fill');
  });
  it('reuses the idempotency key after a submission connection error', async () => {
    mocks.create.mockRejectedValueOnce(new Error('Connection interrupted'));
    await generateEdgeFill(state.clips[0].id, 'fill'); const requestId = state.clips[0].effects[1].params.requestId;
    expect(requestId).toBeTruthy(); await generateEdgeFill(state.clips[0].id, 'fill');
    expect(mocks.create.mock.calls[1][1]).toBe(requestId);
  });
  it('does not attach a generated fill after the photo moves', async () => {
    mocks.poll.mockImplementationOnce(async () => { state.clips[0].transform.position.x = .1; return { status: 'completed', imageUrl: '/api/fill' }; });
    await generateEdgeFill(state.clips[0].id, 'fill');
    expect(mocks.save).not.toHaveBeenCalled(); expect(edgeFillJob(state.clips[0].id, 'fill').error).toContain('photo placement changed');
  });
  it('does not apply results after corrections or project session changes', async () => {
    mocks.poll.mockImplementationOnce(async () => { state.clips[0].effects[0].params.distortion = 30; return { status: 'completed', imageUrl: '/api/fill' }; });
    await generateEdgeFill(state.clips[0].id, 'fill'); expect(mocks.save).not.toHaveBeenCalled();
    expect(edgeFillJob(state.clips[0].id, 'fill').error).toContain('Correction or photo placement changed');
    state.clips[0].effects[0].params.distortion = 20;
    mocks.poll.mockImplementationOnce(async () => { publication = { ...publication, sessionEpoch: 'other' }; return { status: 'completed', imageUrl: '/api/fill' }; });
    await generateEdgeFill(state.clips[0].id, 'fill'); expect(mocks.save).not.toHaveBeenCalled();
    expect(edgeFillJob(state.clips[0].id, 'fill').error).toContain('Project changed');
  });
  it('rejects animated upstream geometry before charging; an empty fill passes through', async () => {
    state.clipKeyframes.set(state.clips[0].id, [{ property: 'effect.lens.scale', value: 80 }]);
    await generateEdgeFill(state.clips[0].id, 'fill'); expect(mocks.create).not.toHaveBeenCalled();
    expect(edgeFillJob(state.clips[0].id, 'fill').error).toContain('animated geometry');
    expect(aiEdgeFill.byteTexture!({}, {} as never)).toBeNull();
    expect([...aiEdgeFill.packUniforms({ mix: NaN, seamBlend: 0 }, 1, 1)!]).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0]);
  });
  it('allows unchanged static keyframes', async () => {
    state.clipKeyframes.set(state.clips[0].id, [{ property: 'effect.lens.scale', value: 100 }]);
    await generateEdgeFill(state.clips[0].id, 'fill');
    expect(mocks.create).toHaveBeenCalledTimes(1); expect(state.clips[0].effects[1].params.canvasSpace).toBe(true);
  });
  it('fingerprints geometry independently of key order and ignores disabled effects', () => {
    const effects = [lens(), fill()]; const source = edgeFillSource(file, effects, 'fill');
    effects[0].params = { scale: 100, distortion: 20 }; effects.unshift({ ...lens(), type: 'blur', enabled: false });
    expect(edgeFillSource(file, effects, 'fill').signature).toBe(source.signature);
    effects[1].params.scale = 120; expect(edgeFillSource(file, effects, 'fill').signature).not.toBe(source.signature);
  });
});
