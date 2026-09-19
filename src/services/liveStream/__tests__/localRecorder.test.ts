import { describe, expect, it, vi } from 'vitest';
import type {
  CaptureRecoveryBlobStore,
  CaptureRecoveryChunkInput,
  CaptureRecoveryChunkRef,
} from '../../capture/recording/recoveryPersistence';
import { startLocalStreamRecording, type LocalStreamRecordingDeps } from '../localRecorder';

class FakeMediaRecorder {
  static supportedTypes = new Set<string>();
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = vi.fn((mimeType: string) => FakeMediaRecorder.supportedTypes.has(mimeType));

  readonly mimeType: string;
  state: RecordingState = 'inactive';
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: MediaRecorder['onerror'] = null;
  start = vi.fn((timeslice?: number) => {
    this.state = 'recording';
    this.timeslice = timeslice;
  });
  stop = vi.fn(() => {
    this.emitChunk(new Blob(['final'], { type: this.mimeType }), 8_000);
    this.state = 'inactive';
    this.onstop?.();
  });
  timeslice?: number;

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType ?? '';
    FakeMediaRecorder.instances.push(this);
  }

  emitChunk(data: Blob, timecode: number) {
    this.ondataavailable?.({ data, timecode } as BlobEvent);
  }
}

function createBlobStore() {
  const blobs = new Map<string, Blob>();
  const inputs: CaptureRecoveryChunkInput[] = [];
  const deleted: string[] = [];
  const store: CaptureRecoveryBlobStore = {
    async putChunk(input) {
      inputs.push(input);
      const artifactId = `artifact-${input.chunkIndex}`;
      blobs.set(artifactId, input.blob);
      return {
        artifactId,
        chunkIndex: input.chunkIndex,
        mimeType: input.mimeType,
        bytes: input.blob.size,
        startedAt: input.startedAt,
        timeStart: input.timeStart,
      } satisfies CaptureRecoveryChunkRef;
    },
    async getChunk(ref) {
      return blobs.get(ref.artifactId) ?? null;
    },
    async deleteRef(artifactId) {
      deleted.push(artifactId);
      blobs.delete(artifactId);
    },
  };
  return { store, inputs, deleted };
}

function createDeps(blobStore: CaptureRecoveryBlobStore, importFile = vi.fn(async (file: File) => ({ name: file.name }))): LocalStreamRecordingDeps {
  return {
    MediaRecorderImpl: FakeMediaRecorder as unknown as NonNullable<LocalStreamRecordingDeps['MediaRecorderImpl']>,
    blobStore,
    importFile,
  };
}

describe('startLocalStreamRecording', () => {
  it('persists timeslice chunks, assembles them in order, imports once, and deletes them', async () => {
    FakeMediaRecorder.instances = [];
    FakeMediaRecorder.supportedTypes = new Set(['video/webm']);
    const { store, inputs, deleted } = createBlobStore();
    const importFile = vi.fn(async (file: File) => ({ name: file.name }));
    const handle = startLocalStreamRecording({} as MediaStream, { now: () => new Date(2026, 7, 24, 13, 5).getTime() }, createDeps(store, importFile));
    const recorder = FakeMediaRecorder.instances[0];

    expect(recorder.timeslice).toBe(4_000);
    recorder.emitChunk(new Blob(['first'], { type: 'video/webm' }), 0);
    recorder.emitChunk(new Blob(['second'], { type: 'video/webm' }), 4_000);

    const result = await handle.stop();

    expect(inputs.map(input => input.chunkIndex)).toEqual([0, 1, 2]);
    expect(importFile).toHaveBeenCalledTimes(1);
    const importedFile = importFile.mock.calls[0][0];
    // jsdom Files lack Blob.text(); FileReader works in both environments.
    const importedText = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(importedFile);
    });
    expect(importedText).toBe('firstsecondfinal');
    expect(importedFile.name).toBe('Stream Recording 2026-08-24 13.05.webm');
    expect(deleted).toEqual(['artifact-0', 'artifact-1', 'artifact-2']);
    expect(result).toEqual({ importedMediaName: importedFile.name });
  });

  it('cancels by deleting persisted chunks without importing', async () => {
    FakeMediaRecorder.instances = [];
    FakeMediaRecorder.supportedTypes = new Set(['video/webm']);
    const { store, deleted } = createBlobStore();
    const importFile = vi.fn(async (file: File) => ({ name: file.name }));
    const handle = startLocalStreamRecording({} as MediaStream, {}, createDeps(store, importFile));
    FakeMediaRecorder.instances[0].emitChunk(new Blob(['partial'], { type: 'video/webm' }), 0);

    await handle.cancel();
    await handle.cancel();

    expect(importFile).not.toHaveBeenCalled();
    expect(deleted).toEqual(['artifact-0', 'artifact-1']);
  });

  it('selects the first supported MIME type in fallback order', () => {
    FakeMediaRecorder.instances = [];
    FakeMediaRecorder.isTypeSupported.mockClear();
    FakeMediaRecorder.supportedTypes = new Set(['video/webm;codecs=h264,opus', 'video/webm']);

    startLocalStreamRecording({} as MediaStream, {}, createDeps(createBlobStore().store));

    expect(FakeMediaRecorder.isTypeSupported.mock.calls.map(([candidate]) => candidate)).toEqual([
      'video/mp4;codecs=avc1,mp4a.40.2',
      'video/mp4',
      'video/webm;codecs=h264,opus',
    ]);
    expect(FakeMediaRecorder.instances[0].mimeType).toBe('video/webm;codecs=h264,opus');
  });
});
