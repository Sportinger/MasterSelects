import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSeedancePreproductionController } from '../../src/marketing/useSeedancePreproductionController';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useSeedancePreproductionStore } from '../../src/stores/seedancePreproductionStore';

beforeEach(() => {
  useSeedancePreproductionStore.getState().reset();
  useMediaStore.setState({ files: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
  useSeedancePreproductionStore.getState().reset();
});

describe('Seedance preproduction cancellation', () => {
  it('aborts the active browser request and leaves the stopped run retryable', async () => {
    let ideasSignal: AbortSignal | null = null;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/source-frames')) {
        return Response.json({
          schemaVersion: 1,
          kind: 'source-frame-status',
          sourceBundleId: 'source-bundle-empty',
          complete: true,
          media: [],
        });
      }
      const request = JSON.parse(String(init?.body)) as {
        input: { fingerprint?: string };
        operation: string;
      };
      if (request.operation === 'ingest-sources') {
        const fingerprint = request.input.fingerprint!;
        return Response.json({
          schemaVersion: 1,
          kind: 'source-bundle',
          id: `source-bundle-${fingerprint}`,
          fingerprint,
          createdAt: 1,
          entryCount: 0,
        });
      }
      ideasSignal = init?.signal ?? null;
      return new Promise<Response>((_resolve, reject) => {
        ideasSignal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        }, { once: true });
      });
    }));
    const { result } = renderHook(() => useSeedancePreproductionController({
      executeDirectEdit: vi.fn(),
    }));
    let startPromise: ReturnType<typeof result.current.start>;

    act(() => {
      startPromise = result.current.start('Build a video');
    });
    await waitFor(() => expect(ideasSignal).not.toBeNull());

    act(() => result.current.stop());

    await expect(startPromise!).resolves.toBe('stopped');
    expect(ideasSignal?.aborted).toBe(true);
    const state = useSeedancePreproductionStore.getState();
    expect(state.activeRunId).toMatch(/^seedance-preproduction-/);
    expect(state.runs[state.activeRunId!]?.phase).toBe('failed');
    expect(useSeedancePreproductionStore.getState().sourceBundle).toBeDefined();
  });
});
