import type { JsonValue } from '../contracts';
import type { FieldClass } from './fieldOwnership';
import { domainSchemas, namedSchemas } from './nestedSchemas';

export interface DomainSchema {
  fields?: Record<string, { class: FieldClass; owner: string; node: string | null }>;
  variants?: string[];
  element?: string | null;
  dictionary?: string | null;
}
export type DomainFieldPatches = Record<string, JsonValue>;
export interface NestedDomainSplit { content: JsonValue; patches: Partial<Record<FieldClass, DomainFieldPatches>>; }
const pointer = (name: string): string => name.replaceAll('~', '~0').replaceAll('/', '~1');
function resolveSchema(id: string | null | undefined, value: JsonValue): DomainSchema | undefined {
  const schema: DomainSchema | undefined = id ? domainSchemas[id] : undefined;
  if (!schema?.variants) return schema;
  const candidates = schema.variants.map((variant) => resolveSchema(variant, value)).filter((item): item is DomainSchema => !!item);
  if (Array.isArray(value)) return candidates.find((item) => 'element' in item);
  if (!value || typeof value !== 'object') return undefined;
  return candidates.toSorted((a, b) => {
    const score = (item: DomainSchema) => Object.keys(value).filter((key) => key in (item.fields ?? {})).length + ('dictionary' in item ? 0.5 : 0);
    return score(b) - score(a);
  })[0];
}

/** Applies the same exhaustive field ownership to nested DTOs, not just ProjectFile. */
export function splitNestedDomain(value: JsonValue, typeName: string): NestedDomainSplit {
  const patches: NestedDomainSplit['patches'] = {};
  const walk = (input: JsonValue, schemaId: string | null | undefined, path: string): JsonValue => {
    const schema = resolveSchema(schemaId, input);
    if (!input || typeof input !== 'object' || !schema) return input;
    if (Array.isArray(input)) return input.map((item, index) => walk(item, schema.element, `${path}/${index}`));
    const result: Record<string, JsonValue> = Object.create(null);
    for (const [name, child] of Object.entries(input)) {
      const childPath = `${path}/${pointer(name)}`;
      const field = schema.fields?.[name];
      if (!field) {
        if (name.startsWith('$') || 'dictionary' in schema || !schema.fields) result[name] = walk(child, schema.dictionary, childPath);
        else throw new TypeError(`Unclassified nested DTO field: ${typeName}${childPath}`);
      } else if (field.class === 'content' || field.class === 'mixed' || field.class === 'container') {
        result[name] = walk(child, field.node, childPath);
      } else {
        // Cache/derived recovery is local; journal mutations never enter content undo.
        (patches[field.class] ??= {})[childPath] = child;
      }
    }
    return result;
  };
  return { content: walk(value, namedSchemas[typeName], ''), patches };
}

export function restoreNestedDomain(value: JsonValue, patches: DomainFieldPatches): JsonValue {
  // value is already a detached projection decoded from immutable records.
  for (const [path, fieldValue] of Object.entries(patches).toSorted(([a], [b]) => a.split('/').length - b.split('/').length)) {
    const names = path.slice(1).split('/').map((name) => name.replaceAll('~1', '/').replaceAll('~0', '~'));
    if (names.some((name) => name === '__proto__')) throw new TypeError('Invalid domain field patch');
    let owner: JsonValue = value;
    for (const name of names.slice(0, -1)) {
      if (!owner || typeof owner !== 'object') throw new TypeError(`Invalid field patch path: ${path}`);
      const record = owner as Record<string, JsonValue>;
      owner = record[name] ??= {};
    }
    if (!owner || typeof owner !== 'object') throw new TypeError(`Invalid field patch owner: ${path}`);
    (owner as Record<string, JsonValue>)[names[names.length - 1]] = fieldValue;
  }
  return value;
}
