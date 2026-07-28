import { beforeEach, describe, expect, it } from 'vitest';
import { createMuscriptorStore } from '../../src/stores/muscriptorStore';

describe('MuScriptor store', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to the small model, automatic device selection, and transient state', () => {
    const store = createMuscriptorStore();
    expect(store.getState()).toMatchObject({
      setupStatus: 'not-checked',
      variant: 'small',
      device: 'auto',
      instruments: [],
      jobId: null,
      noteCount: 0,
    });
    expect(localStorage.length).toBe(0);
  });

  it('updates setup and job progress without persisting credentials or runtime handles', () => {
    const store = createMuscriptorStore();
    store.getState().setSetupProgress(120, 'download', 'Downloaded chunk');
    store.getState().setInstruments([' violin ', 'drums', 'violin', '']);
    store.getState().setJobState({
      isProcessing: true,
      jobId: 'job-1',
      jobProgress: 42,
      noteCount: 17,
    });

    expect(store.getState()).toMatchObject({
      setupProgress: 100,
      setupStep: 'download',
      setupLog: ['Downloaded chunk'],
      instruments: ['violin', 'drums'],
      isProcessing: true,
      jobId: 'job-1',
      jobProgress: 42,
      noteCount: 17,
    });
    expect(Object.keys(store.getState())).not.toContain('hfToken');
    expect(localStorage.length).toBe(0);
  });

  it('resets arrays and job state to fresh defaults', () => {
    const store = createMuscriptorStore();
    store.getState().setInstruments(['violin']);
    store.getState().setEnvironment({ modelsDownloaded: ['small'] });
    store.getState().setJobState({ jobId: 'job-1', noteCount: 9 });
    store.getState().reset();

    expect(store.getState()).toMatchObject({
      instruments: [],
      modelsDownloaded: [],
      jobId: null,
      noteCount: 0,
      variant: 'small',
      device: 'auto',
    });
  });
});
