import type { TransitionParamValue } from '../../transitions';

export const TRANSITION_MIME_TYPE = 'application/x-transition-type';

export interface TransitionDropData {
  type: string;
  duration: number;
  params?: Record<string, TransitionParamValue>;
}

let activeTransitionDragData: TransitionDropData | null = null;

export function setActiveTransitionDragData(data: TransitionDropData | null): void {
  activeTransitionDragData = data;
}

export function getActiveTransitionDragData(): TransitionDropData | null {
  return activeTransitionDragData;
}

export function serializeTransitionDropData(data: TransitionDropData): string {
  return JSON.stringify(data);
}

export function parseTransitionDropData(value: string): TransitionDropData | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<TransitionDropData>;
    const duration = parsed.duration;
    if (typeof parsed.type !== 'string' || typeof duration !== 'number' || !Number.isFinite(duration)) return null;
    const params = parseTransitionParams(parsed.params);
    return {
      type: parsed.type,
      duration,
      ...(params ? { params } : {}),
    };
  } catch {
    return null;
  }
}

function parseTransitionParams(value: unknown): Record<string, TransitionParamValue> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

  const params: Record<string, TransitionParamValue> = {};
  for (const [key, paramValue] of Object.entries(value)) {
    if (
      typeof paramValue === 'string' ||
      typeof paramValue === 'number' ||
      typeof paramValue === 'boolean'
    ) {
      params[key] = paramValue;
    }
  }

  return Object.keys(params).length > 0 ? params : undefined;
}
