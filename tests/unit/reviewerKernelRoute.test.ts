import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../functions/lib/env';

const mocks = vi.hoisted(() => ({ normalPath: vi.fn() }));
vi.mock('../../functions/lib/hostedAgent/route', () => ({ tryHandleNormalPath: mocks.normalPath }));
import { onRequest } from '../../functions/api/kernel/[[path]]';

function context(path: string, reviewer: boolean): AppContext {
  return {
    data: { user: { id: 'user-1', email: 'review@example.test', reviewer } },
    env: {
      KERNEL_AUTH_TOKEN: 'service-token',
      KERNEL_ORIGIN: 'https://regular.example.test',
      KERNEL_REVIEW_ORIGIN: 'https://review.example.test',
    },
    params: { path },
    request: new Request(`https://www.masterselects.com/api/kernel/${path}`),
    next: vi.fn(),
    waitUntil: vi.fn(),
  } as unknown as AppContext;
}

describe('reviewer kernel route', () => {
  it('routes a review Normal Path turn to the isolated origin', async () => {
    mocks.normalPath.mockResolvedValueOnce(new Response('review turn'));
    const response = await onRequest(context('normal/turns', true));
    expect(response.status).toBe(200);
    expect(mocks.normalPath).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({ HOSTED_AGENT_KERNEL_ORIGIN: 'https://review.example.test' }),
      }),
      'normal/turns',
    );
  });

  it('refuses a shared origin and all non-Normal review kernel routes', async () => {
    mocks.normalPath.mockClear();
    const shared = context('normal/turns', true);
    shared.env.KERNEL_REVIEW_ORIGIN = shared.env.KERNEL_ORIGIN;
    expect((await onRequest(shared)).status).toBe(503);
    expect((await onRequest(context('preproduction/seedance', true))).status).toBe(503);
    expect(mocks.normalPath).not.toHaveBeenCalled();
  });

  it('keeps regular accounts on the standard origin', async () => {
    mocks.normalPath.mockResolvedValueOnce(new Response('regular turn'));
    const response = await onRequest(context('normal/turns', false));
    expect(response.status).toBe(200);
    expect(mocks.normalPath).toHaveBeenCalledWith(
      expect.objectContaining({ env: expect.not.objectContaining({ HOSTED_AGENT_KERNEL_ORIGIN: expect.anything() }) }),
      'normal/turns',
    );
  });
});
