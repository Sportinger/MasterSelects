import { afterEach, describe, expect, it, vi } from 'vitest';
import { RenderLoop } from '../../src/engine/render/RenderLoop';
import { holdEditorContentPublication } from '../../src/services/project/repository/transaction/editorPublication';

vi.mock('../../src/services/logger', () => ({
  Logger: { create: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })) },
}));

function startLoop(state: { recovering: boolean; exporting: boolean }) {
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.push(callback); return callbacks.length; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const onRender = vi.fn(() => true);
  const loop = new RenderLoop({ recordRafGap: vi.fn(), resetPerSecondCounters: vi.fn() } as never, {
    onRender,
    isRecovering: () => state.recovering,
    isExporting: () => state.exporting,
  });
  let now = 1000;
  const tick = (ms = 16) => { now += ms; callbacks.shift()!(now); };
  loop.start();
  // Leave the startup frame and idle grace behind: a static timeline renders only on request.
  tick(); tick(1500); tick();
  onRender.mockClear();
  return { loop, onRender, tick };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('RenderLoop deferred render requests', () => {
  it('renders once when idle and asked, then stays idle', () => {
    const { loop, onRender, tick } = startLoop({ recovering: false, exporting: false });
    try {
      tick(); expect(onRender).not.toHaveBeenCalled();
      loop.requestRender(); tick(); tick(); tick();
      expect(onRender).toHaveBeenCalledOnce();
    } finally { loop.stop(); }
  });

  it('keeps a request made while publication is blocked and renders when it reopens', () => {
    const { loop, onRender, tick } = startLoop({ recovering: false, exporting: false });
    const release = holdEditorContentPublication();
    try {
      // e.g. project activation asks for its first frame while the open barrier holds.
      loop.requestRender();
      tick(); tick(); tick();
      expect(onRender).not.toHaveBeenCalled();
      release();
      tick();
      expect(onRender).toHaveBeenCalledOnce();
      tick(); tick();
      expect(onRender).toHaveBeenCalledOnce();
    } finally { release(); loop.stop(); }
  });

  it('keeps requests made during device recovery or export', () => {
    const state = { recovering: true, exporting: false };
    const { loop, onRender, tick } = startLoop(state);
    try {
      loop.requestRender(); tick(); tick();
      expect(onRender).not.toHaveBeenCalled();
      state.recovering = false; state.exporting = true;
      tick(); tick();
      expect(onRender).not.toHaveBeenCalled();
      state.exporting = false;
      tick();
      expect(onRender).toHaveBeenCalledOnce();
    } finally { loop.stop(); }
  });
});
