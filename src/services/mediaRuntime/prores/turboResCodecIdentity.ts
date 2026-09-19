export const TURBORES_PRORES_FOURCCS = [
  'apco',
  'apcs',
  'apcn',
  'apch',
  'ap4h',
  'ap4x',
] as const;

export type TurboResProResFourCC = (typeof TURBORES_PRORES_FOURCCS)[number];

export const PRORES_RAW_FOURCCS = ['aprn', 'aprh'] as const;

export type ProResCodecKind = 'classic' | 'raw' | 'not-prores';

export type TurboResCodecDecision =
  | { kind: 'turbores'; fourCC: TurboResProResFourCC }
  | { kind: 'disabled'; fourCC: TurboResProResFourCC }
  | { kind: 'unsupported-prores-raw'; fourCC: (typeof PRORES_RAW_FOURCCS)[number] }
  | { kind: 'not-prores'; codecId?: string };

export function normalizeVideoCodecId(codecId: unknown): string | undefined {
  if (typeof codecId !== 'string') return undefined;
  const normalized = codecId.trim();
  if (!normalized) return undefined;
  return normalized.length === 4 ? normalized.toLowerCase() : normalized;
}

export function getTurboResProResFourCC(codecId: unknown): TurboResProResFourCC | undefined {
  const normalized = normalizeVideoCodecId(codecId);
  return TURBORES_PRORES_FOURCCS.includes(normalized as TurboResProResFourCC)
    ? normalized as TurboResProResFourCC
    : undefined;
}

export function getProResRawFourCC(codecId: unknown): (typeof PRORES_RAW_FOURCCS)[number] | undefined {
  const normalized = normalizeVideoCodecId(codecId);
  return PRORES_RAW_FOURCCS.includes(normalized as (typeof PRORES_RAW_FOURCCS)[number])
    ? normalized as (typeof PRORES_RAW_FOURCCS)[number]
    : undefined;
}

export function classifyProResCodec(codecId: unknown): ProResCodecKind {
  if (getTurboResProResFourCC(codecId)) return 'classic';
  if (getProResRawFourCC(codecId)) return 'raw';
  return 'not-prores';
}

export function decideTurboResCodec(
  codecId: unknown,
  turboResEnabled: boolean,
): TurboResCodecDecision {
  const normalized = normalizeVideoCodecId(codecId);
  const classicFourCC = getTurboResProResFourCC(normalized);
  if (classicFourCC) {
    return turboResEnabled
      ? { kind: 'turbores', fourCC: classicFourCC }
      : { kind: 'disabled', fourCC: classicFourCC };
  }
  const rawFourCC = getProResRawFourCC(normalized);
  if (rawFourCC) {
    return { kind: 'unsupported-prores-raw', fourCC: rawFourCC };
  }
  return { kind: 'not-prores', codecId: normalized };
}

export function getProResCodecLabel(codecId: unknown): string | undefined {
  switch (normalizeVideoCodecId(codecId)) {
    case 'apco': return 'ProRes 422 Proxy';
    case 'apcs': return 'ProRes 422 LT';
    case 'apcn': return 'ProRes 422';
    case 'apch': return 'ProRes 422 HQ';
    case 'ap4h': return 'ProRes 4444';
    case 'ap4x': return 'ProRes 4444 XQ';
    case 'aprn': return 'ProRes RAW';
    case 'aprh': return 'ProRes RAW HQ';
    default: return undefined;
  }
}
