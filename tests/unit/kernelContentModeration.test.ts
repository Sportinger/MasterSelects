import { afterEach, describe, expect, it, vi } from 'vitest';

import { onRequest } from '../../functions/api/kernel/[[path]]';
import { clearImageModerationCache } from '../../functions/lib/aiModeration';
import type { AppContext, Env } from '../../functions/lib/env';
import {
  hostedAgentResultImages,
  kernelRelayImages,
  moderateHostedAgentStart,
} from '../../functions/lib/kernelContentModeration';

const env = {
  KERNEL_AUTH_TOKEN: 'kernel-token',
  KERNEL_ORIGIN: 'https://kernel.example.test',
  OPENAI_API_KEY: 'test-key',
} as Env;

const cleanFrame = 'data:image/jpeg;base64,CLEAN';
const explicitFrame = 'data:image/jpeg;base64,EXPLICIT';

afterEach(() => {
  vi.unstubAllGlobals();
  clearImageModerationCache();
});

/** Moderation flags `sexual` for the explicit frame and `violence` for any text; the kernel answers OK. */
function stubUpstreams() {
  const kernelCalls: string[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (!url.includes('/v1/moderations')) {
      kernelCalls.push(url);
      return Response.json({ ok: true });
    }
    const input = (JSON.parse(String(init?.body)) as { input: unknown }).input;
    const categories = typeof input === 'string'
      ? ['violence']
      : (input as Array<{ image_url: { url: string } }>)[0].image_url.url === explicitFrame ? ['sexual'] : [];
    return Response.json({
      results: [{
        categories: Object.fromEntries(categories.map((category) => [category, true])),
        flagged: categories.length > 0,
      }],
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, kernelCalls };
}

function sourceFrameItems(count: number, explicitIndex?: number) {
  return [
    ...Array.from({ length: count }, (_, index) => ({
      dataUrl: index === explicitIndex ? explicitFrame : `data:image/jpeg;base64,F${index}`,
      index,
      kind: 'source-frame',
    })),
    { dataUrl: 'data:image/jpeg;base64,SHEET', index: 0, kind: 'contact-sheet' },
  ];
}

describe('kernel content moderation', () => {
  it('extracts captured frame grids from hosted-agent operation results', () => {
    expect(hostedAgentResultImages({
      batchId: 'batch-1',
      result: {
        batchId: 'batch-1',
        results: [
          { operationId: 'timeline.editor.inspect.v1', result: { data: { clips: [] }, success: true }, sequence: 1 },
          {
            operationId: 'timeline.visual.capture-grid.v1',
            result: { data: { frameTimes: [1], imageDataUrl: cleanFrame }, success: true },
            sequence: 2,
          },
        ],
        success: true,
      },
    })).toEqual([cleanFrame]);
  });

  it('samples every contact sheet and every fourth Seedance source frame', () => {
    const images = kernelRelayImages('preproduction/seedance/source-frames', { items: sourceFrameItems(16) });

    expect(images).toEqual([
      'data:image/jpeg;base64,F0',
      'data:image/jpeg;base64,F4',
      'data:image/jpeg;base64,F8',
      'data:image/jpeg;base64,F12',
      'data:image/jpeg;base64,SHEET',
    ]);
  });

  it('allows violent editing requests but blocks explicit inline references', async () => {
    stubUpstreams();
    const start = (source: string, transport = 'data-url') => moderateHostedAgentStart(env, {
      request: 'cut the fight scene shorter',
      visualReferences: [{ source, transport }],
    });

    expect((await start(cleanFrame)).blocked).toBe(false);
    expect((await start('ref-123', 'authenticated-ref')).blocked).toBe(false);
    const blocked = await start(explicitFrame);
    expect(blocked.blocked).toBe(true);
    expect(blocked.moderation.categories).toContain('image:sexual');
  });

  it('rejects explicit Seedance source frames before relaying them to the kernel', async () => {
    const { kernelCalls } = stubUpstreams();
    const post = (items: unknown) => onRequest({
      data: { user: { email: 'user@example.test', id: 'user-123' } },
      env,
      next: async () => new Response(null),
      params: { path: 'preproduction/seedance/source-frames' },
      request: new Request('https://masterselects.test/api/kernel/preproduction/seedance/source-frames', {
        body: JSON.stringify({ items, schemaVersion: 1, sourceBundleId: 'bundle', sourceMediaId: 'media' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
      waitUntil: () => undefined,
    } satisfies AppContext);

    const blocked = await post(sourceFrameItems(16, 8));
    expect(blocked.status).toBe(400);
    expect(await blocked.json()).toMatchObject({
      code: 'content_policy_violation',
      error: 'This request was blocked by content safety checks.',
    });
    expect(kernelCalls).toHaveLength(0);

    const relayed = await post(sourceFrameItems(16));
    expect(relayed.status).toBe(200);
    expect(kernelCalls).toHaveLength(1);
  });
});
