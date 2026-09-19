import { buildPremiereProjectImportResult, summarizePremiereProject } from './premiereProjectBuilder';
import { createPremiereProjectStreamParser } from './premiereProjectStreamParser';
import type {
  PremiereExistingMediaDescriptor,
  PremiereProjectImportOptions,
  PremiereProjectImportResult,
  PremiereProjectSummary,
} from './premiereProjectTypes';

export function parsePremiereProjectXmlText(
  xmlText: string,
  fileName: string,
  existingMedia: readonly PremiereExistingMediaDescriptor[],
  parentId: string | null = null,
  selectedSequenceUids?: readonly string[],
): PremiereProjectImportResult {
  const parser = createPremiereProjectStreamParser();
  parser.write(xmlText);
  return buildPremiereProjectImportResult(
    parser.close(),
    fileName,
    existingMedia,
    parentId,
    selectedSequenceUids,
  );
}

export async function parsePremiereProjectFile(
  file: File,
  existingMedia: readonly PremiereExistingMediaDescriptor[],
  parentId: string | null = null,
  options: PremiereProjectImportOptions = {},
): Promise<PremiereProjectImportResult> {
  const graph = await readPremiereProjectGraph(file, options);
  throwIfAborted(options.signal);
  let selectedSequenceUids = options.selectedSequenceUids;
  if (!selectedSequenceUids && options.selectSequences) {
    const selection = await options.selectSequences(summarizePremiereProject(graph));
    if (selection === null) throw createAbortError();
    selectedSequenceUids = selection;
  }
  options.onProgress?.({ phase: 'building', percent: 92, detail: 'Building MasterSelects compositions' });
  const result = buildPremiereProjectImportResult(
    graph,
    file.name,
    existingMedia,
    parentId,
    selectedSequenceUids,
  );
  options.onProgress?.({ phase: 'complete', percent: 100, detail: 'Premiere project imported' });
  return result;
}

export async function inspectPremiereProjectFile(
  file: File,
  options: Pick<PremiereProjectImportOptions, 'signal' | 'onProgress'> = {},
): Promise<PremiereProjectSummary> {
  const graph = await readPremiereProjectGraph(file, options);
  throwIfAborted(options.signal);
  options.onProgress?.({ phase: 'building', percent: 96, detail: 'Preparing sequence list' });
  return summarizePremiereProject(graph);
}

export async function readPremiereProjectGraph(
  file: File,
  options: Pick<PremiereProjectImportOptions, 'signal' | 'onProgress'>,
) {
  throwIfAborted(options.signal);
  const gzip = await isGzipFile(file);
  if (gzip && typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot decompress Premiere project files.');
  }

  const parser = createPremiereProjectStreamParser();
  const decoder = new TextDecoder();
  let lastProgress = -1;
  let bytesRead = 0;
  const countedStream = file.stream().pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      throwIfAborted(options.signal);
      bytesRead += chunk.byteLength;
      const percent = Math.min(88, Math.max(1, Math.round((bytesRead / Math.max(1, file.size)) * 88)));
      if (percent !== lastProgress) {
        lastProgress = percent;
        options.onProgress?.({
          phase: gzip ? 'parsing' : 'reading',
          percent,
          detail: gzip ? 'Decompressing and parsing Premiere XML' : 'Parsing Premiere XML',
        });
      }
      controller.enqueue(chunk);
    },
  }));
  const xmlBytes = gzip
    ? countedStream.pipeThrough(
      new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>,
    )
    : countedStream;
  const reader = xmlBytes.getReader();
  try {
    while (true) {
      throwIfAborted(options.signal);
      const { done, value } = await reader.read();
      if (done) break;
      parser.write(decoder.decode(value, { stream: true }));
    }
    const trailingText = decoder.decode();
    if (trailingText) parser.write(trailingText);
    return parser.close();
  } finally {
    reader.releaseLock();
  }
}

async function isGzipFile(file: File): Promise<boolean> {
  const header = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  return header[0] === 0x1f && header[1] === 0x8b;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw createAbortError();
}

function createAbortError(): DOMException {
  return new DOMException('Premiere project import was cancelled.', 'AbortError');
}
