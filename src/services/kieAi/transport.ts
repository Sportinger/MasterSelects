import type { AccountInfo } from '../piApiService';
import type { KieAiProxyErrorResponse } from './apiContracts';
import {
  BASE_URL,
  BYO_PROXY_REQUEST_URL,
  canUseSameOriginProxy,
} from './config';
import { log } from './log';

export type KieAiRequest = <T>(
  endpoint: string,
  method?: 'GET' | 'POST',
  body?: object,
) => Promise<T>;

export interface KieAiTransport {
  request: KieAiRequest;
  getAccountInfo: () => Promise<AccountInfo>;
}

export function createKieAiTransport(getApiKey: () => string, hasApiKey: () => boolean): KieAiTransport {
  const request = async <T>(
    endpoint: string,
    method: 'GET' | 'POST' = 'GET',
    body?: object,
  ): Promise<T> => {
    if (!hasApiKey()) {
      throw new Error('Kie.ai API key not set');
    }

    const response = canUseSameOriginProxy()
      ? await fetch(BYO_PROXY_REQUEST_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-kieai-api-key': getApiKey(),
          },
          body: JSON.stringify({ endpoint, method, body }),
        })
      : await fetch(`${BASE_URL}${endpoint}`, {
          method,
          headers: {
            'Authorization': `Bearer ${getApiKey()}`,
            'Content-Type': 'application/json',
          },
          body: body ? JSON.stringify(body) : undefined,
        });

    const responseText = await response.text();
    let result: T;

    try {
      result = JSON.parse(responseText) as T;
    } catch {
      log.error('Failed to parse response:', responseText);
      throw new Error(`Kie.ai error: ${response.status} - Invalid JSON response`);
    }

    if (!response.ok) {
      log.error('API error:', result);
      const errorResult = result as KieAiProxyErrorResponse & Record<string, unknown>;
      const errorMsg = errorResult.msg || errorResult.message || errorResult.error || responseText;
      throw new Error(`Kie.ai error: ${response.status} - ${errorMsg}`);
    }

    return result;
  };

  return {
    request,
    getAccountInfo: async () => {
      if (!hasApiKey()) {
        throw new Error('Kie.ai API key not set');
      }

      const response = await fetch(`${BASE_URL}/api/v1/chat/credit`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${getApiKey()}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to get account info: ${response.status}`);
      }

      const result = await response.json();
      log.debug('Kie.ai credit info:', result);

      const credits = result.data ?? 0;
      return {
        accountName: 'Kie.ai',
        accountId: '',
        credits,
        creditsUsd: credits * 0.005,
      };
    },
  };
}
