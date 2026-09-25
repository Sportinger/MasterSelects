import type { ToolDefinition } from '../types';

const documentId = { type: 'string', description: 'Stable project document ID.' };
const expectedRevision = { type: 'number', description: 'Document revision observed by the caller. Mutations fail if it changed.' };

export const documentToolDefinitions: ToolDefinition[] = [
  { type: 'function', function: { name: 'listDocuments', description: 'List project documents with IDs, kinds, revisions, source format and page counts.',
    parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'searchDocuments', description: 'Search project document text and return bounded block anchors.',
    parameters: { type: 'object', properties: { query: { type: 'string' }, documentId }, required: ['query'] } } },
  { type: 'function', function: { name: 'readDocument', description: 'Read a bounded document range by block, production page or source page with stable anchors and links.',
    parameters: { type: 'object', properties: { documentId,
      blockId: { type: 'string' }, productionPage: { type: 'string' }, sourcePage: { type: 'number' },
      limit: { type: 'number', description: 'Maximum number of blocks, up to 40.' },
    }, required: ['documentId'] } } },
  { type: 'function', function: { name: 'getDocumentLinks', description: 'Read typed media and annotation links for one document block.',
    parameters: { type: 'object', properties: { documentId, blockId: { type: 'string' } }, required: ['documentId', 'blockId'] } } },
  { type: 'function', function: { name: 'createProjectDocument', description: 'Create a general project document or screenplay.',
    parameters: { type: 'object', properties: { title: { type: 'string' }, kind: { type: 'string', enum: ['general', 'screenplay'] } }, required: ['title', 'kind'] } } },
  { type: 'function', function: { name: 'editDocumentBlock', description: 'Replace one block in a document, rejecting stale revisions.',
    parameters: { type: 'object', properties: { documentId, expectedRevision, blockId: { type: 'string' }, text: { type: 'string' } },
      required: ['documentId', 'expectedRevision', 'blockId', 'text'] } } },
  { type: 'function', function: { name: 'addDocumentComment', description: 'Attach a comment to a stable range in a document block.',
    parameters: { type: 'object', properties: { documentId, expectedRevision, blockId: { type: 'string' },
      start: { type: 'number' }, end: { type: 'number' }, text: { type: 'string' } },
      required: ['documentId', 'expectedRevision', 'blockId', 'start', 'end', 'text'] } } },
  { type: 'function', function: { name: 'addDocumentMediaLink', description: 'Attach an exact source, clip, composition or annotation target to document text.',
    parameters: { type: 'object', properties: { documentId, expectedRevision, blockId: { type: 'string' },
      start: { type: 'number' }, end: { type: 'number' },
      targetKind: { type: 'string', enum: ['source', 'clip', 'composition', 'source-annotation', 'composition-annotation'] },
      mediaId: { type: 'string' }, compositionId: { type: 'string' }, clipId: { type: 'string' }, annotationId: { type: 'string' },
      targetStart: { type: 'number' }, targetEnd: { type: 'number' } },
      required: ['documentId', 'expectedRevision', 'blockId', 'start', 'end', 'targetKind'] } } },
];
