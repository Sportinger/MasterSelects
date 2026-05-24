import {
  RUNTIME_CAPABILITIES,
  type RuntimeCapability,
  type RuntimeCapabilityPolicy,
  type RuntimeCapabilityRequest,
  type RuntimePolicyDecision,
} from './types';

const CAPABILITY_SET = new Set<string>(RUNTIME_CAPABILITIES);

export function isRuntimeCapability(value: unknown): value is RuntimeCapability {
  return typeof value === 'string' && CAPABILITY_SET.has(value);
}

export function normalizeRuntimeCapabilities(values: readonly unknown[]): RuntimeCapability[] {
  return [...new Set(values.filter(isRuntimeCapability))];
}

export function checkRuntimeCapabilities(
  policy: RuntimeCapabilityPolicy | undefined,
  request: RuntimeCapabilityRequest,
): RuntimePolicyDecision {
  if (!policy) {
    return { allowed: false, reason: `Unknown provider: ${request.providerId}` };
  }

  if (policy.providerId !== request.providerId) {
    return {
      allowed: false,
      reason: `Capability policy belongs to "${policy.providerId}", not "${request.providerId}"`,
    };
  }

  const granted = new Set(policy.granted);
  const requested = normalizeRuntimeCapabilities(request.requested);
  const invalid = request.requested.filter((capability) => !isRuntimeCapability(capability));
  if (invalid.length > 0) {
    return { allowed: false, reason: `Unknown capability: ${String(invalid[0])}` };
  }

  const missingCapabilities = requested.filter((capability) => !granted.has(capability));
  if (missingCapabilities.length > 0) {
    return {
      allowed: false,
      reason: `Provider "${request.providerId}" lacks capability "${missingCapabilities[0]}"`,
      missingCapabilities,
    };
  }

  return { allowed: true };
}
