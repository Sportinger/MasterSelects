import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { usePreviewInitialEditCameraView } from '../../src/components/preview/usePreviewInitialEditCameraView';
import { shouldResetPreviewEditMode } from '../../src/components/preview/usePreviewModeState';

describe('usePreviewInitialEditCameraView', () => {
  it('keeps factory 3D edit panels armed before a project is open', () => {
    expect(shouldResetPreviewEditMode(false, true)).toBe(false);
    expect(shouldResetPreviewEditMode(false, false)).toBe(true);
  });

  it('waits for camera edit mode and applies the factory view only once', () => {
    const setView = vi.fn();
    const initialEdit = { initialEditMode: true, initialEditCameraView: 'side' as const };
    const { rerender } = renderHook(
      ({ active }) => usePreviewInitialEditCameraView(initialEdit, active, setView),
      { initialProps: { active: false } },
    );

    expect(setView).not.toHaveBeenCalled();
    rerender({ active: true });
    rerender({ active: false });
    rerender({ active: true });

    expect(setView).toHaveBeenCalledOnce();
    expect(setView).toHaveBeenCalledWith('side');
  });

  it('also applies Perspective once so its first frame is rendered', () => {
    const setView = vi.fn();
    renderHook(() => usePreviewInitialEditCameraView(
      { initialEditMode: true, initialEditCameraView: 'camera' },
      true,
      setView,
    ));

    expect(setView).toHaveBeenCalledOnce();
    expect(setView).toHaveBeenCalledWith('camera');
  });
});
