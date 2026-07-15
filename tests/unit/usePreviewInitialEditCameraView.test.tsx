import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { usePreviewInitialEditCameraView } from '../../src/components/preview/usePreviewInitialEditCameraView';

describe('usePreviewInitialEditCameraView', () => {
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
});
