import { afterEach, describe, expect, it, vi } from 'vitest';

import { kieAiService } from '../../src/services/kieAiService';

describe('kieAiService', () => {
  afterEach(() => {
    kieAiService.setApiKey('');
    vi.unstubAllGlobals();
  });

  it('converts Kie.ai vendor credits to their USD value for balance display', async () => {
    kieAiService.setApiKey('kie_test_key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 200, msg: 'success', data: 200 }), { status: 200 }),
    ));

    await expect(kieAiService.getAccountInfo()).resolves.toMatchObject({
      credits: 200,
      creditsUsd: 1,
    });
  });
});
