import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPENAI_MODEL_ID,
  getOpenAiModelEntry,
  getOpenAiModelPricing,
  OPENAI_CHAT_DROPDOWN_MODELS,
} from '../../src/shared/openAiModelCatalog';
import { getModelPricing } from '../../functions/lib/modelPricing';

describe('OpenAI model catalog', () => {
  it('uses the intended default chat model', () => {
    expect(DEFAULT_OPENAI_MODEL_ID).toBe('gpt-5.1');
  });

  it('maps current chat-capable models to the expected credit cost', () => {
    expect(getOpenAiModelPricing('gpt-5.4')).toEqual({ creditCost: 8, tier: 'high' });
    expect(getOpenAiModelPricing('gpt-5.4-mini')).toEqual({ creditCost: 3, tier: 'mid' });
    expect(getOpenAiModelPricing('gpt-5.2')).toEqual({ creditCost: 7, tier: 'high' });
    expect(getOpenAiModelPricing('gpt-4o')).toEqual({ creditCost: 6, tier: 'high' });
  });

  it('keeps the backend pricing helper in sync with the shared catalog', () => {
    for (const modelId of ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.2', 'gpt-4o']) {
      expect(getModelPricing(modelId)).toEqual(getOpenAiModelPricing(modelId));
    }
  });

  it('exposes reasoning-effort capabilities for chat models that support them', () => {
    expect(getOpenAiModelEntry('gpt-5.4')?.supportedReasoningEfforts).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
    expect(getOpenAiModelEntry('gpt-5')?.supportedReasoningEfforts).toEqual([
      'minimal',
      'low',
      'medium',
      'high',
    ]);
    expect(getOpenAiModelEntry('gpt-4.1')?.supportedReasoningEfforts).toEqual([]);
  });

  it('hides non-chat-completions or internal-only models from the dropdown', () => {
    const dropdownModelIds = OPENAI_CHAT_DROPDOWN_MODELS.map((entry) => entry.id);

    expect(dropdownModelIds).toContain('gpt-5.4');
    expect(dropdownModelIds).toContain('gpt-5.3-chat-latest');
    expect(dropdownModelIds).not.toContain('gpt-5.4-pro');
    expect(dropdownModelIds).not.toContain('gpt-5.1-codex');
    expect(dropdownModelIds).not.toContain('o3-pro');
  });
});
