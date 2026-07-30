import { act, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { useFlashBoardMultishotController } from '../../src/components/panels/flashboard/useFlashBoardMultishotController';

function useMultishotHarness(selectionKey: string, initialAudio = false) {
  const [generateAudio, setGenerateAudio] = useState(initialAudio);
  const controller = useFlashBoardMultishotController({
    duration: 10,
    generateAudio,
    isAudioMode: false,
    selectionKey,
    selectedEntryOutputType: 'video',
    setGenerateAudio,
    supportsAudio: true,
    supportsMultiShot: true,
  });

  return { ...controller, generateAudio };
}

describe('useFlashBoardMultishotController', () => {
  it('starts with multi-shot off and restores the prior sound setting when disabled', async () => {
    const { result } = renderHook(() => useMultishotHarness('cloud:cloud-kling'));

    expect(result.current.multiShots).toBe(false);
    expect(result.current.generateAudio).toBe(false);

    await act(async () => {
      result.current.handleMultiShotToggle();
      await Promise.resolve();
    });
    expect(result.current.multiShots).toBe(true);
    expect(result.current.generateAudio).toBe(true);

    await act(async () => {
      result.current.handleMultiShotToggle();
      await Promise.resolve();
    });
    expect(result.current.multiShots).toBe(false);
    expect(result.current.generateAudio).toBe(false);
  });

  it('resets multi-shot when the selected model changes', async () => {
    const { result, rerender } = renderHook(
      ({ selectionKey }) => useMultishotHarness(selectionKey),
      { initialProps: { selectionKey: 'cloud:cloud-kling' } },
    );

    await act(async () => {
      result.current.handleMultiShotToggle();
      await Promise.resolve();
    });
    expect(result.current.multiShots).toBe(true);

    rerender({ selectionKey: 'kieai:kling-3.0' });

    await waitFor(() => {
      expect(result.current.multiShots).toBe(false);
    });
  });
});
