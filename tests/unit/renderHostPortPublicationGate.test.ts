import { describe, expect, it, vi } from 'vitest';
import { engine } from '../../src/engine/WebGPUEngine';
import { renderHostPort } from '../../src/services/render/renderHostPort';
import { holdEditorContentPublication } from '../../src/services/project/repository/transaction/editorPublication';

describe('renderHostPort publication gate', () => {
  it('defers a direct render made while publication is blocked to the render loop', () => {
    vi.mocked(engine.render).mockClear();
    vi.mocked(engine.requestRender).mockClear();
    const release = holdEditorContentPublication();
    try {
      renderHostPort.render([]);
      expect(engine.render).not.toHaveBeenCalled();
      expect(engine.requestRender).toHaveBeenCalledOnce();
    } finally { release(); }
    renderHostPort.render([]);
    expect(engine.render).toHaveBeenCalledOnce();
  });
});
