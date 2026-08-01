import {
  decodeMotionTemplateEnvelope,
  encodeMotionTemplateEnvelope,
} from './templates/codec';
import type { MotionTemplateEnvelopeV1 } from './templates/contracts';

const STORAGE_KEY = 'masterselects.motionTemplates';
const STORAGE_VERSION = 1 as const;
export const MOTION_TEMPLATE_LIBRARY_CAP = 100;

interface MotionTemplateLibraryEnvelope {
  version: typeof STORAGE_VERSION;
  templates: string[];
}

export interface MotionTemplateLibraryRead {
  templates: MotionTemplateEnvelopeV1[];
  warnings: string[];
}

/** User-local template library; project-embedded templates are a later packet. */
export function listMotionTemplates(): MotionTemplateLibraryRead {
  if (typeof localStorage === 'undefined') return { templates: [], warnings: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { templates: [], warnings: [] };
    const parsed: unknown = JSON.parse(raw);
    if (!isEnvelope(parsed)) return { templates: [], warnings: ['Motion template library was invalid'] };
    const warnings: string[] = [];
    const templates = parsed.templates.flatMap((serialized, index) => {
      const decoded = decodeMotionTemplateEnvelope(serialized);
      if (decoded.ok) return [decoded.envelope];
      warnings.push(`Skipped corrupt motion template at index ${index}`);
      return [];
    });
    return { templates, warnings };
  } catch {
    return { templates: [], warnings: ['Motion template library could not be read'] };
  }
}

export function saveMotionTemplateToLibrary(template: MotionTemplateEnvelopeV1): MotionTemplateLibraryRead {
  const encoded = encodeMotionTemplateEnvelope(template);
  if (!encoded.ok || !encoded.json) {
    throw new Error(encoded.ok ? 'Motion template codec did not produce JSON' : encoded.failures[0]?.message ?? 'Motion template codec rejected the envelope');
  }
  const current = listMotionTemplates();
  const templates = [...current.templates.filter((item) => item.templateId !== template.templateId), template]
    .sort((left, right) => templateCreatedAt(left) - templateCreatedAt(right))
    .slice(-MOTION_TEMPLATE_LIBRARY_CAP);
  persist(templates);
  return { templates, warnings: current.warnings };
}

export function getMotionTemplateFromLibrary(id: string): MotionTemplateEnvelopeV1 | undefined {
  return listMotionTemplates().templates.find((template) => template.templateId === id);
}

function templateCreatedAt(template: MotionTemplateEnvelopeV1): number {
  // V1 deliberately has no createdAt field. The ID is monotonic for templates
  // captured here, while old/imported templates retain stable insertion order.
  const match = /_(\d+)_/.exec(template.templateId);
  return match ? Number(match[1]) : 0;
}

function persist(templates: readonly MotionTemplateEnvelopeV1[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const serialized = templates.map((template) => {
      const encoded = encodeMotionTemplateEnvelope(template);
      if (!encoded.ok || !encoded.json) throw new Error('Motion template codec rejected library entry');
      return encoded.json;
    });
    const envelope: MotionTemplateLibraryEnvelope = { version: STORAGE_VERSION, templates: serialized };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    // Library persistence is best-effort; callers keep their in-memory read.
  }
}

function isEnvelope(value: unknown): value is MotionTemplateLibraryEnvelope {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && (value as { version?: unknown }).version === STORAGE_VERSION
    && Array.isArray((value as { templates?: unknown }).templates)
    && (value as { templates: unknown[] }).templates.every((template) => typeof template === 'string');
}
