import type { StoryboardClipProperties } from '../../../types/storyboard';

export type StoryboardCardDensity = 'bar' | 'title' | 'compact' | 'full';

export interface StoryboardCardTextLayout {
  titleLines: string[];
  descriptionLines: string[];
}

export interface StoryboardCardRenderPayload {
  schemaVersion: 1;
  clipId: string;
  sceneId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  dpr: number;
  density: StoryboardCardDensity;
  backgroundColor: string;
  borderColor: string;
  titleColor: string;
  secondaryTextColor: string;
  fontFamily: string;
  titleFontSize: number;
  bodyFontSize: number;
  titleLines: string[];
  descriptionLines: string[];
  status: StoryboardClipProperties['status'];
  statusLabel: string;
  badgeLabels: string[];
  durationLabel: string;
  textLayoutCacheKey: string;
}

export interface CreateStoryboardCardRenderPayloadInput {
  clip: {
    id: string;
    duration: number;
    source?: { type?: string | null } | null;
    storyboardProperties?: StoryboardClipProperties;
  };
  x: number;
  y: number;
  width: number;
  height: number;
  dpr?: number;
  fontFamily?: string;
  textLayoutCache?: StoryboardCardTextLayoutCache;
}

const DEFAULT_STORYBOARD_COLOR = '#6657d9';
const DEFAULT_FONT_FAMILY = 'Inter, system-ui, sans-serif';
const MAX_TEXT_LAYOUT_CACHE_ENTRIES = 500;

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function parseHexColor(color: string): [number, number, number] | null {
  const match = /^#([\da-f]{6})$/i.exec(color.trim());
  if (!match) return null;
  return [
    Number.parseInt(match[1].slice(0, 2), 16),
    Number.parseInt(match[1].slice(2, 4), 16),
    Number.parseInt(match[1].slice(4, 6), 16),
  ];
}

function tint(color: string, lightness: number): string {
  const rgb = parseHexColor(color) ?? parseHexColor(DEFAULT_STORYBOARD_COLOR)!;
  const target = lightness >= 0 ? 255 : 0;
  const amount = Math.abs(lightness);
  return `rgb(${rgb.map(channel => clampByte(channel + (target - channel) * amount)).join(', ')})`;
}

function resolveDensity(width: number, height: number): StoryboardCardDensity {
  if (width < 14 || height < 12) return 'bar';
  if (width < 76 || height < 30) return 'title';
  if (width < 170 || height < 52) return 'compact';
  return 'full';
}

function normalizedText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function wrapText(
  value: string,
  maxWidth: number,
  fontSize: number,
  maxLines: number,
): string[] {
  if (maxLines <= 0 || maxWidth <= 0) return [];
  const text = normalizedText(value);
  if (!text) return [];
  const approximateCharacterWidth = Math.max(1, fontSize * 0.56);
  const maxCharacters = Math.max(4, Math.floor(maxWidth / approximateCharacterWidth));
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxCharacters) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word.length > maxCharacters ? word.slice(0, maxCharacters) : word;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);

  const consumed = lines.join(' ').length;
  if (lines.length === maxLines && consumed < text.length) {
    const lastIndex = lines.length - 1;
    lines[lastIndex] = `${lines[lastIndex].slice(0, Math.max(1, maxCharacters - 1)).trimEnd()}…`;
  }
  return lines;
}

function createTextLayoutCacheKey(input: {
  properties: StoryboardClipProperties;
  width: number;
  height: number;
  dpr: number;
  fontFamily: string;
  density: StoryboardCardDensity;
}): string {
  return JSON.stringify([
    input.properties.title,
    input.properties.description,
    input.width,
    input.height,
    input.dpr,
    input.fontFamily,
    input.density,
  ]);
}

function createTextLayout(
  properties: StoryboardClipProperties,
  width: number,
  height: number,
  density: StoryboardCardDensity,
): StoryboardCardTextLayout {
  const textWidth = Math.max(0, width - 16);
  if (density === 'bar') return { titleLines: [], descriptionLines: [] };
  if (density === 'title') {
    return {
      titleLines: wrapText(properties.title, textWidth, 11, 1),
      descriptionLines: [],
    };
  }
  if (density === 'compact') {
    return {
      titleLines: wrapText(properties.title, textWidth, 11, 1),
      descriptionLines: wrapText(properties.description, textWidth, 10, 1),
    };
  }
  const descriptionLines = Math.max(1, Math.min(4, Math.floor((height - 48) / 13)));
  return {
    titleLines: wrapText(properties.title, textWidth, 12, 2),
    descriptionLines: wrapText(properties.description, textWidth, 10, descriptionLines),
  };
}

export class StoryboardCardTextLayoutCache {
  private readonly entries = new Map<string, StoryboardCardTextLayout>();

  getOrCreate(
    key: string,
    create: () => StoryboardCardTextLayout,
  ): StoryboardCardTextLayout {
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached;
    }
    const created = create();
    this.entries.set(key, created);
    if (this.entries.size > MAX_TEXT_LAYOUT_CACHE_ENTRIES) {
      this.entries.delete(this.entries.keys().next().value as string);
    }
    return created;
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

export const storyboardCardTextLayoutCache = new StoryboardCardTextLayoutCache();

export function createStoryboardCardRenderPayload(
  input: CreateStoryboardCardRenderPayloadInput,
): StoryboardCardRenderPayload | null {
  const properties = input.clip.storyboardProperties;
  if (input.clip.source?.type !== 'storyboard' || !properties) return null;
  const width = Math.max(0, input.width);
  const height = Math.max(0, input.height);
  const dpr = Math.max(1, input.dpr ?? 1);
  const fontFamily = input.fontFamily ?? DEFAULT_FONT_FAMILY;
  const density = resolveDensity(width, height);
  const baseColor = properties.color ?? DEFAULT_STORYBOARD_COLOR;
  const textLayoutCacheKey = createTextLayoutCacheKey({
    properties,
    width,
    height,
    dpr,
    fontFamily,
    density,
  });
  const layout = (input.textLayoutCache ?? storyboardCardTextLayoutCache).getOrCreate(
    textLayoutCacheKey,
    () => createTextLayout(properties, width, height, density),
  );
  const badgeLabels = [
    properties.selectedCandidateId ? 'Candidate selected' : null,
    properties.filledClipIds?.length ? `${properties.filledClipIds.length} filled` : null,
    properties.evidenceRefIds?.length ? `${properties.evidenceRefIds.length} refs` : null,
    properties.variantSetIds?.length ? `${properties.variantSetIds.length} variants` : null,
  ].filter((label): label is string => !!label);

  return {
    schemaVersion: 1,
    clipId: input.clip.id,
    sceneId: properties.sceneId,
    x: input.x,
    y: input.y,
    width,
    height,
    dpr,
    density,
    backgroundColor: tint(baseColor, -0.42),
    borderColor: tint(baseColor, 0.22),
    titleColor: '#ffffff',
    secondaryTextColor: 'rgba(255, 255, 255, 0.78)',
    fontFamily,
    titleFontSize: density === 'full' ? 12 : 11,
    bodyFontSize: 10,
    titleLines: [...layout.titleLines],
    descriptionLines: [...layout.descriptionLines],
    status: properties.status,
    statusLabel: properties.status.replace(/-/g, ' '),
    badgeLabels,
    durationLabel: `${input.clip.duration.toFixed(1)}s / ${properties.targetDurationSeconds.toFixed(1)}s`,
    textLayoutCacheKey,
  };
}
