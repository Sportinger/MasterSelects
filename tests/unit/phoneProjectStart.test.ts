// P4 project start of the phone editor: browser-storage creation scope, the loading view's plain
// steps and elapsed time, and the "Recent project loads" rows of Settings > Diagnostics.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/project/core/browserStorageRoot', () => ({
  isBrowserStorageFallbackActive: () => false,
  getBrowserStorageRoot: vi.fn(),
}));

import {
  isBrowserStorageProjectRootForced,
  resolveProjectRootMode,
  withBrowserStorageProjectRoot,
} from '../../src/services/project/core/projectRootAccess';
import {
  formatPhoneLoadElapsed,
  phoneLoadStep,
  phoneLoadTitle,
  runPhoneProjectOperation,
  usePhoneProjectOperationStore,
} from '../../src/components/mobileSkin/runtime/phoneProjectOperation';
import {
  describePhoneProjectLoads,
  formatLoadSeconds,
  formatPhoneProjectLoads,
} from '../../src/components/mobileSkin/settings/phoneProjectLoads';
import type { ProjectLoadTiming } from '../../src/services/project/load/projectLoadTelemetry';
import type { ProjectLoadProgress } from '../../src/stores/mediaStore';

type PickerWindow = Window & { showDirectoryPicker?: unknown; showSaveFilePicker?: unknown };

function withPicker(): () => void {
  const win = window as PickerWindow;
  win.showDirectoryPicker = vi.fn();
  win.showSaveFilePicker = vi.fn();
  const storage = navigator.storage as unknown as { getDirectory?: unknown } | undefined;
  const hadStorage = Boolean(storage);
  if (!hadStorage) Object.defineProperty(navigator, 'storage', { configurable: true, value: { getDirectory: vi.fn() } });
  else if (typeof storage!.getDirectory !== 'function') (storage as { getDirectory?: unknown }).getDirectory = vi.fn();
  return () => {
    delete win.showDirectoryPicker;
    delete win.showSaveFilePicker;
    if (!hadStorage) Reflect.deleteProperty(navigator, 'storage');
  };
}

afterEach(() => {
  usePhoneProjectOperationStore.setState({ operation: null });
});

describe('withBrowserStorageProjectRoot', () => {
  it('resolves browser storage inside the scope although a folder picker exists, and the picker again after it', async () => {
    const restore = withPicker();
    try {
      expect(resolveProjectRootMode()).toBe('fsa');
      const inside = await withBrowserStorageProjectRoot(async () => {
        await Promise.resolve();
        return { mode: resolveProjectRootMode(), forced: isBrowserStorageProjectRootForced() };
      });
      expect(inside).toEqual({ mode: 'opfs', forced: true });
      expect(resolveProjectRootMode()).toBe('fsa');
      expect(isBrowserStorageProjectRootForced()).toBe(false);
    } finally {
      restore();
    }
  });

  it('ends the scope when the creation throws', async () => {
    const restore = withPicker();
    try {
      await expect(withBrowserStorageProjectRoot(async () => { throw new Error('disk gone'); })).rejects.toThrow('disk gone');
      expect(resolveProjectRootMode()).toBe('fsa');
    } finally {
      restore();
    }
  });

  it('refuses with a sentence when the browser has no project storage at all', async () => {
    const storage = Object.getOwnPropertyDescriptor(navigator, 'storage');
    Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined });
    try {
      const create = vi.fn();
      await expect(withBrowserStorageProjectRoot(create)).rejects.toThrow();
      expect(create).not.toHaveBeenCalled();
    } finally {
      if (storage) Object.defineProperty(navigator, 'storage', storage);
      else Reflect.deleteProperty(navigator, 'storage');
    }
  });
});

const idle: ProjectLoadProgress = { active: false, phase: 'idle', percent: 0, message: '' };
const progress = (phase: ProjectLoadProgress['phase'], message: string): ProjectLoadProgress => ({ active: true, phase, percent: 40, message, blocking: true });

describe('phone loading view model', () => {
  it('names the step in plain words', () => {
    expect(phoneLoadStep('create', idle)).toBe('creating');
    expect(phoneLoadStep('open', idle)).toBe('opening');
    expect(phoneLoadStep('open', progress('opening', 'Opening saved project'))).toBe('opening');
    expect(phoneLoadStep('open', progress('media', 'Reading saved project'))).toBe('reading');
    expect(phoneLoadStep('open', progress('opening', 'Restoring project history'))).toBe('reading');
    expect(phoneLoadStep('open', progress('timeline', 'Restoring editor'))).toBe('preparing');
    expect(phoneLoadStep('resume', progress('opening', 'Allowing project folder access'))).toBe('waiting');
    expect(phoneLoadStep('resume', idle)).toBe('waiting');
    expect(phoneLoadStep('resume', progress('opening', 'Opening saved project'))).toBe('waiting');
  });

  it('shows the elapsed time only after 5 s', () => {
    expect(formatPhoneLoadElapsed(4_999)).toBeNull();
    expect(formatPhoneLoadElapsed(5_000)).toBe('5 s');
    expect(formatPhoneLoadElapsed(64_000)).toBe('1 min 04 s');
  });

  it('titles the view with the project name', () => {
    expect(phoneLoadTitle({ kind: 'create', name: 'Rehearsal', startedAt: 0 })).toBe('Creating “Rehearsal”');
    expect(phoneLoadTitle({ kind: 'resume', name: 'Tour', startedAt: 0 })).toBe('Reopening “Tour”');
    expect(phoneLoadTitle(null)).toBe('Opening your last project');
  });

  it('covers the screen while the operation runs and always ends it, also on a failure', async () => {
    let seen: unknown = null;
    await runPhoneProjectOperation('open', 'Tour', async () => { seen = usePhoneProjectOperationStore.getState().operation; });
    expect(seen).toMatchObject({ kind: 'open', name: 'Tour' });
    expect(usePhoneProjectOperationStore.getState().operation).toBeNull();
    await expect(runPhoneProjectOperation('create', 'X', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(usePhoneProjectOperationStore.getState().operation).toBeNull();
  });
});

describe('recent project loads', () => {
  const timing = (over: Partial<ProjectLoadTiming>): ProjectLoadTiming => ({
    kind: 'open', outcome: 'ready', totalMs: 1234, storage: 'opfs',
    phases: { storage_open: 410, session_read: 620, activation: 204 },
    mainThread: { longTaskMs: 0, longTaskMaxMs: 0, longTaskCount: 0, frameGapMaxMs: 180, pageHidden: false },
    ...over,
  });

  it('formats seconds', () => {
    expect(formatLoadSeconds(410)).toBe('0.41 s');
    expect(formatLoadSeconds(31_200)).toBe('31.2 s');
    expect(formatLoadSeconds(-1)).toBe('0.00 s');
  });

  it('lists the newest load first, as seconds per phase in plain words', () => {
    const rows = describePhoneProjectLoads([
      timing({ kind: 'create', totalMs: 900, phases: { target: 300, initialize: 600 } }),
      timing({ firstFrameMs: 6_000, phases: { session_read: 29_800 }, totalMs: 30_100 }),
    ]);
    expect(rows.map((row) => row.title)).toEqual(['Open · browser storage', 'Create · browser storage']);
    expect(rows[0]).toMatchObject({ total: '30.1 s', slow: true, firstFrame: '6.00 s', frameGap: '0.18 s' });
    expect(rows[0].phases).toEqual([{ phase: 'session_read', label: 'Reading project', seconds: '29.8 s', slow: true }]);
    expect(rows[1].phases.map((phase) => phase.label)).toEqual(['Writing the new project', 'First revision']);
    expect(formatPhoneProjectLoads(rows)[1]).toBe('- Open · browser storage ready: total 30.1 s · session_read 29.8 s · first frame 6.00 s');
  });

  it('has nothing to copy without loads', () => {
    expect(formatPhoneProjectLoads(describePhoneProjectLoads([]))).toEqual([]);
  });
});
