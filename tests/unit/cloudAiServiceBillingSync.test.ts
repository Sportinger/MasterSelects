import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BillingSummaryResponse } from '../../src/services/cloudApi';

const { createChatMock, createVideoMock, videoCapabilitiesMock } = vi.hoisted(() => ({
  createChatMock: vi.fn(),
  createVideoMock: vi.fn(),
  videoCapabilitiesMock: vi.fn(),
}));

vi.mock('../../src/services/cloudApi', () => ({
  cloudApi: {
    ai: {
      chat: {
        create: createChatMock,
        stream: vi.fn(),
      },
      video: {
        capabilities: videoCapabilitiesMock,
        create: createVideoMock,
        status: vi.fn(),
      },
    },
  },
}));

import { cloudAiService } from '../../src/services/cloudAiService';
import { useAccountStore } from '../../src/stores/accountStore';

function createBillingSummary(creditBalance: number): BillingSummaryResponse {
  return {
    creditBalance,
    entitlements: {},
    hostedAIEnabled: true,
    plan: {
      id: 'starter',
      label: 'Starter',
      monthlyCredits: 4500,
    },
    recentCredits: [],
    stripeCustomerId: 'cus_test',
    subscription: {
      cancelAtPeriodEnd: false,
      currentPeriodEnd: '2026-05-14T10:16:15.000Z',
      currentPeriodStart: '2026-04-14T10:16:15.000Z',
      id: 'sub_local',
      planId: 'starter',
      status: 'active',
      stripeSubscriptionId: 'sub_stripe',
      updatedAt: '2026-04-14T10:16:15.000Z',
    },
    usage: {
      byFeature: [],
      completedCount: 0,
      creditCost: 0,
      failedCount: 0,
      pendingCount: 0,
      since: '2026-04-01T00:00:00.000Z',
    },
    user: null,
  };
}

function resetAccountStore(creditBalance = 200): void {
  useAccountStore.setState({
    billingSummary: createBillingSummary(creditBalance),
    creditBalance,
    dialog: null,
    entitlements: {},
    error: null,
    hostedAIEnabled: true,
    isInitialized: true,
    isLoading: false,
    notice: null,
    session: {
      authenticated: true,
      provider: 'magic_link',
    },
    user: {
      email: 'mail@romankuskowski.de',
      id: 'user_1',
    },
  });
}

describe('cloudAiService billing sync', () => {
  beforeEach(() => {
    createChatMock.mockReset();
    createVideoMock.mockReset();
    videoCapabilitiesMock.mockReset();
    resetAccountStore();
  });

  it('updates accountStore immediately after hosted video creation', async () => {
    createVideoMock.mockResolvedValue({
      creditBalance: 160,
      data: { taskId: 'task_123' },
      kind: 'ai.video',
      mode: 'hosted',
      ok: true,
      provider: 'cloud-kling',
      requestId: 'req_1',
      status: 'accepted',
    });

    const taskId = await cloudAiService.createTextToVideo({
      aspectRatio: '16:9',
      duration: 5,
      mode: 'std',
      prompt: 'Sunset over the sea',
      provider: 'cloud-kling',
      version: 'latest',
    });

    expect(taskId).toBe('task_123');
    expect(useAccountStore.getState().creditBalance).toBe(160);
    expect(useAccountStore.getState().billingSummary?.creditBalance).toBe(160);
  });

  it('updates accountStore immediately after hosted chat completion', async () => {
    createChatMock.mockResolvedValue({
      creditBalance: 154,
      data: { text: 'done' },
      kind: 'ai.chat',
      mode: 'hosted',
      ok: true,
      provider: 'openai',
      requestId: 'req_2',
      status: 'completed',
    });

    await cloudAiService.createChatCompletion({
      messages: [{ content: 'hello', role: 'user' }],
      model: 'gpt-4.1-mini',
    });

    expect(useAccountStore.getState().creditBalance).toBe(154);
    expect(useAccountStore.getState().billingSummary?.creditBalance).toBe(154);
  });
});
