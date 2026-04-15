export interface LottieJsonRoot extends Record<string, unknown> {
  v?: string;
  fr?: number;
  ip?: number;
  op?: number;
  w?: number;
  h?: number;
  nm?: string;
  layers?: unknown[];
  assets?: unknown[];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isPotentialLottieJsonFile(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  return (
    lowerName.endsWith('.json') ||
    file.type === 'application/json' ||
    file.type.endsWith('+json')
  );
}

export function isLottieJsonData(value: unknown): value is LottieJsonRoot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as LottieJsonRoot;
  return (
    typeof candidate.v === 'string' &&
    isFiniteNumber(candidate.fr) &&
    isFiniteNumber(candidate.ip) &&
    isFiniteNumber(candidate.op) &&
    Array.isArray(candidate.layers)
  );
}

export function parseLottieJsonText(text: string): LottieJsonRoot | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isLottieJsonData(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function readLottieJsonFile(file: File): Promise<{
  data: LottieJsonRoot;
  text: string;
} | null> {
  if (!isPotentialLottieJsonFile(file)) {
    return null;
  }

  const text = await file.text();
  const data = parseLottieJsonText(text);
  if (!data) {
    return null;
  }

  return { data, text };
}
