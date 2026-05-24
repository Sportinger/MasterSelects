export const RUNTIME_CAPABILITIES = [
  'file.read',
  'file.write',
  'artifact.read',
  'artifact.write',
  'project.read',
  'project.write',
  'network.fetch',
  'time.now',
  'random',
  'gpu.compute',
  'timeline.mutate',
  'ai.invoke',
] as const;

export type RuntimeCapability = typeof RUNTIME_CAPABILITIES[number];

export type RuntimePolicyDecision =
  | { allowed: true }
  | { allowed: false; reason: string; missingCapabilities?: RuntimeCapability[] };

export interface RuntimeCapabilityPolicy {
  providerId: string;
  granted: RuntimeCapability[];
  requiresConfirmation?: boolean;
}

export interface RuntimeCapabilityRequest {
  providerId: string;
  requested: RuntimeCapability[];
}
