export type SeedancePromptReferenceType = 'audio' | 'image' | 'video';

export interface SeedancePromptReference {
  id: string;
  type: SeedancePromptReferenceType;
}

export interface PromptInsertionResult {
  caret: number;
  prompt: string;
}

const TOKEN_LABELS: Record<SeedancePromptReferenceType, string> = {
  audio: 'Audio',
  image: 'Image',
  video: 'Video',
};

const PROMPT_REFERENCE_PATTERN = /@(Image|Video|Audio)(\d+)/gi;

function isSeedancePromptReferenceType(value: string | undefined): value is SeedancePromptReferenceType {
  return value === 'audio' || value === 'image' || value === 'video';
}

export function buildSeedancePromptReferences(
  referenceMediaFileIds: string[],
  getMediaType: (mediaFileId: string) => string | undefined,
): SeedancePromptReference[] {
  return referenceMediaFileIds.flatMap((id) => {
    const type = getMediaType(id);
    return isSeedancePromptReferenceType(type) ? [{ id, type }] : [];
  });
}

export function getSeedancePromptReferenceTokens(references: SeedancePromptReference[]): string[] {
  const counts: Record<SeedancePromptReferenceType, number> = { audio: 0, image: 0, video: 0 };
  return references.map((reference) => {
    counts[reference.type] += 1;
    return `@${TOKEN_LABELS[reference.type]}${counts[reference.type]}`;
  });
}

export function getSeedancePromptReferenceToken(
  references: SeedancePromptReference[],
  mediaFileId: string,
): string | null {
  const index = references.findIndex((reference) => reference.id === mediaFileId);
  return index < 0 ? null : getSeedancePromptReferenceTokens(references)[index] ?? null;
}

export function insertSeedancePromptReferenceTokens(
  prompt: string,
  tokens: string[],
  selectionStart: number,
  selectionEnd: number,
): PromptInsertionResult {
  const insertion = tokens.join(' ');
  if (!insertion) return { caret: selectionStart, prompt };

  const start = Math.max(0, Math.min(prompt.length, selectionStart));
  const end = Math.max(start, Math.min(prompt.length, selectionEnd));
  const before = prompt.slice(0, start);
  const after = prompt.slice(end);
  const leadingSpace = before && !/\s$/.test(before) ? ' ' : '';
  const trailingSpace = after && !/^\s/.test(after) ? ' ' : '';
  const insertedPrefix = `${before}${leadingSpace}${insertion}`;

  return {
    caret: insertedPrefix.length,
    prompt: `${insertedPrefix}${trailingSpace}${after}`,
  };
}

export function remapSeedancePromptReferenceTokens(
  prompt: string,
  previousReferences: SeedancePromptReference[],
  nextReferences: SeedancePromptReference[],
): string {
  const previousTokens = getSeedancePromptReferenceTokens(previousReferences);
  const nextTokens = getSeedancePromptReferenceTokens(nextReferences);
  const mediaIdByToken = new Map(previousTokens.map((token, index) => (
    [token.toLowerCase(), previousReferences[index]?.id]
  )));
  const tokenByMediaId = new Map(nextReferences.map((reference, index) => (
    [reference.id, nextTokens[index]]
  )));
  let removedToken = false;

  const remapped = prompt.replace(PROMPT_REFERENCE_PATTERN, (token) => {
    const mediaFileId = mediaIdByToken.get(token.toLowerCase());
    if (!mediaFileId) return token;
    const nextToken = tokenByMediaId.get(mediaFileId);
    if (nextToken) return nextToken;
    removedToken = true;
    return '';
  });

  return removedToken
    ? remapped
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+([,.;:!?])/g, '$1')
      .replace(/^[ \t]+|[ \t]+$/gm, '')
    : remapped;
}
