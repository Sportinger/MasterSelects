import { describe, expect, it } from 'vitest';

import {
  HOSTED_AGENT_OPERATION_RESULT_IDS,
  validHostedAgentProjectedOperationResult,
} from '../../functions/lib/hostedAgent/route';
import {
  PUBLIC_OPERATION_CONTRACT_V1,
} from '../../src/services/kernelClient/wp1Spike/publicOperationContracts';

const MEDIA_GENERATION_OPERATION_IDS = [
  'media.generation.commit.v1',
  'media.generation.model.inspect.v1',
  'media.generation.preview.v1',
  'media.generation.status.v1',
] as const;

describe('Normal Path operation-result boundary', () => {
  it('mirrors every operation ID in the pinned public contract', () => {
    expect(HOSTED_AGENT_OPERATION_RESULT_IDS.toSorted()).toEqual(
      PUBLIC_OPERATION_CONTRACT_V1.operations.map(({ id }) => id).toSorted(),
    );
  });

  it.each(MEDIA_GENERATION_OPERATION_IDS)(
    'accepts bounded JSON results for %s',
    (operationId) => {
      expect(validHostedAgentProjectedOperationResult({
        data: {
          providerId: 'nano-banana-2',
          settingsToken: `sha256:${'a'.repeat(64)}`,
        },
        success: true,
      }, operationId)).toBe(true);
    },
  );

  it('rejects inline media and oversized generation results', () => {
    expect(validHostedAgentProjectedOperationResult({
      data: { image: 'data:image/png;base64,AAAA' },
      success: true,
    }, 'media.generation.model.inspect.v1')).toBe(false);
    expect(validHostedAgentProjectedOperationResult({
      data: { value: 'x'.repeat(100_001) },
      success: true,
    }, 'media.generation.model.inspect.v1')).toBe(false);
  });
});
