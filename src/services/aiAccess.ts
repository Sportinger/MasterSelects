export type AiFeature = 'chat' | 'video';
export type AiGatewayMode = 'auto' | 'hosted';
export type AiAccessResultMode = 'hosted' | 'unavailable';

export interface AiAccessInput {
  feature: AiFeature;
  hostedAvailable?: boolean;
  requestedMode?: AiGatewayMode;
}

export interface AiAccessDecision {
  feature: AiFeature;
  hostedAvailable: boolean;
  mode: AiAccessResultMode;
  reason: string;
  requestedMode: AiGatewayMode;
}

function toBoolean(value: unknown): boolean {
  return value === true;
}

export function resolveAiAccess(input: AiAccessInput): AiAccessDecision {
  const hostedAvailable = toBoolean(input.hostedAvailable);
  const requestedMode = input.requestedMode ?? 'auto';

  if (requestedMode === 'hosted') {
    return hostedAvailable
      ? {
          feature: input.feature,
          hostedAvailable,
          mode: 'hosted',
          reason: 'Hosted AI is available and was explicitly requested.',
          requestedMode,
        }
      : {
          feature: input.feature,
          hostedAvailable,
          mode: 'unavailable',
          reason: 'Hosted AI was requested but is not available for this context.',
          requestedMode,
        };
  }

  if (hostedAvailable) {
    return {
      feature: input.feature,
      hostedAvailable,
      mode: 'hosted',
      reason: 'Hosted AI is available and selected by the central decision layer.',
      requestedMode,
    };
  }

  return {
    feature: input.feature,
    hostedAvailable,
    mode: 'unavailable',
    reason: 'Hosted AI is not available for this context.',
    requestedMode,
  };
}

export function isHostedAiDecision(decision: AiAccessDecision): boolean {
  return decision.mode === 'hosted';
}
