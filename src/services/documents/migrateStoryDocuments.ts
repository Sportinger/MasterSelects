import type { SeedancePreproductionProjectState } from '../seedancePreproduction/contracts';
import type { DocumentsProjectState } from '../../types/documents';

export function migrateStoryDocuments(
  story: SeedancePreproductionProjectState | null | undefined,
): DocumentsProjectState {
  return {
    schemaVersion: 1,
    documents: (story?.documents ?? []).map(legacy => ({
      id: `story:${legacy.id}`,
      title: legacy.name,
      kind: 'general',
      schemaVersion: 1,
      revision: 1,
      createdAt: legacy.createdAt,
      updatedAt: legacy.createdAt,
      blocks: legacy.text.replace(/\r\n?/gu, '\n').split('\n').map((text, index) => ({
        id: `story:${legacy.id}:block:${index}`,
        kind: 'paragraph',
        text,
        ...(legacy.format === 'pdf' ? { sourcePage: Number(/^Page (\d+)$/u.exec(text)?.[1]) || undefined } : {}),
      })),
      links: [],
      comments: [],
      source: {
        fileName: legacy.name,
        mimeType: legacy.mimeType,
        format: legacy.format,
        importedAt: legacy.createdAt,
        byteLength: legacy.byteLength,
        fidelity: 'text-only',
        pageCount: legacy.pageCount,
        report: legacy.truncated
          ? 'Legacy Story import was truncated; reimport the file for full text and its original view.'
          : 'Legacy Story import preserved extracted text only; reimport the file for its original view.',
      },
    })),
  };
}
