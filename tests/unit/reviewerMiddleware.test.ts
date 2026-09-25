import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../functions/lib/env';
import { ReviewerAccessRevokedError } from '../../functions/lib/reviewerAccess';

const mocks = vi.hoisted(() => ({ loadUser: vi.fn(), guest: vi.fn() }));
vi.mock('../../functions/lib/auth', () => ({
  loadUserFromSession: mocks.loadUser,
  clearAuthCookies: async (headers: Headers) => { headers.append('Set-Cookie', '__ms_session=; Max-Age=0'); },
}));
vi.mock('../../functions/lib/guestAccess', () => ({ ensureGuestAccess: mocks.guest }));
import { onRequest } from '../../functions/_middleware';

function context(path: string): AppContext {
  return {
    data: {}, env: {}, params: {}, waitUntil: vi.fn(),
    request: new Request(`https://www.masterselects.com${path}`, { method: 'POST' }),
    next: vi.fn(async () => new Response('ordinary route')),
  } as unknown as AppContext;
}

describe('reviewer cloud isolation', () => {
  beforeEach(() => vi.clearAllMocks());
  it('blocks provider, kernel and unclassified APIs before executing their route', async () => {
    mocks.loadUser.mockResolvedValue({ id: 'review', email: 'review@example.test', reviewer: true });
    for (const path of ['/api/ai/chat', '/api/ai/video', '/api/kernel/normal/start', '/api/new-provider']) {
      const ctx = context(path);
      expect((await onRequest(ctx)).status).toBe(503);
      expect(ctx.next).not.toHaveBeenCalled();
    }
    expect(mocks.guest).not.toHaveBeenCalled();
  });
  it('does not turn a revoked review session into guest AI access', async () => {
    mocks.loadUser.mockRejectedValue(new ReviewerAccessRevokedError());
    const ctx = context('/api/ai/chat');
    const response = await onRequest(ctx);
    expect(response.status).toBe(403);
    expect(response.headers.get('Set-Cookie')).toContain('__ms_session=');
    expect(ctx.next).not.toHaveBeenCalled();
    expect(mocks.guest).not.toHaveBeenCalled();
  });
  it('only opens the review allowlist when distinct review providers are configured', async () => {
    mocks.loadUser.mockResolvedValue({ id: 'review', email: 'review@example.test', reviewer: true });
    for (const path of ['/api/me', '/api/billing/summary', '/api/ai/chat', '/api/kernel/normal/turns']) {
      const ctx = context(path);
      ctx.env.KIEAI_REVIEW_API_KEY = 'capped-review-key';
      ctx.env.KERNEL_ORIGIN = 'https://regular.example.test';
      ctx.env.KERNEL_REVIEW_ORIGIN = 'https://review.example.test';
      expect((await onRequest(ctx)).status).toBe(200);
      expect(ctx.next).toHaveBeenCalledOnce();
    }
    for (const path of ['/api/ai/video', '/api/kernel/preproduction/seedance', '/api/new-provider']) {
      const ctx = context(path);
      ctx.env.KIEAI_REVIEW_API_KEY = 'capped-review-key';
      ctx.env.KERNEL_REVIEW_ORIGIN = 'https://review.example.test';
      expect((await onRequest(ctx)).status).toBe(503);
      expect(ctx.next).not.toHaveBeenCalled();
    }
    const sharedOrigin = context('/api/ai/chat');
    sharedOrigin.env.KIEAI_REVIEW_API_KEY = 'capped-review-key';
    sharedOrigin.env.KERNEL_ORIGIN = 'https://same.example.test';
    sharedOrigin.env.KERNEL_REVIEW_ORIGIN = 'https://same.example.test';
    expect((await onRequest(sharedOrigin)).status).toBe(503);
  });
  it('preserves regular account behavior and review logout', async () => {
    mocks.loadUser.mockResolvedValue({ id: 'ordinary', email: 'ordinary@example.test' });
    const ordinary = context('/api/ai/chat');
    expect((await onRequest(ordinary)).status).toBe(200);
    expect(ordinary.next).toHaveBeenCalledOnce();
    mocks.loadUser.mockResolvedValue({ id: 'review', email: 'review@example.test', reviewer: true });
    const logout = context('/api/auth/logout');
    expect((await onRequest(logout)).status).toBe(200);
    expect(logout.next).toHaveBeenCalledOnce();
  });
});
