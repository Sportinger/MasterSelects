import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMixerFaderDraft } from '../../src/components/panels/audio-mixer/useMixerFaderDraft';

describe('useMixerFaderDraft', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      return window.setTimeout(() => callback(performance.now()), 0) as unknown as number;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      window.clearTimeout(id);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('previews drag updates without committing the store until drag end', () => {
    const commit = vi.fn();
    const preview = vi.fn();
    const previewEnd = vi.fn();
    const { result } = renderHook(() => useMixerFaderDraft(0, commit, {
      onPreviewValue: preview,
      onPreviewEnd: previewEnd,
    }));

    act(() => {
      result.current.beginDrag();
      result.current.setDraft(-3);
      result.current.setDraft(-6);
      result.current.setDraft(-9);
    });

    expect(result.current.value).toBe(0);
    expect(commit).not.toHaveBeenCalled();
    expect(preview).toHaveBeenCalledTimes(4);
    expect(preview).toHaveBeenLastCalledWith(-9);

    act(() => {
      result.current.setDraft(-12);
      result.current.endDrag();
    });

    expect(result.current.value).toBe(-12);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenLastCalledWith(-12);
    expect(previewEnd).toHaveBeenCalledTimes(1);
  });
});
