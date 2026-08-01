export class InertDescriptorPreflightError extends Error {
  readonly path: string;

  constructor(message: string, path: string) {
    super(message);
    this.name = 'InertDescriptorPreflightError';
    this.path = path;
  }
}

export type InertRecord = Record<string, unknown>;

function reject(message: string, path: string): never {
  throw new InertDescriptorPreflightError(message, path);
}

function requirePlainRecord(value: unknown, path: string): InertRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    reject(`${path} must be a plain object`, path);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    reject(`${path} must use a plain object prototype`, path);
  }
  return value as InertRecord;
}

/**
 * Validates an exact object envelope without invoking any property getter.
 * Every accepted field must be an enumerable own data property with a defined value.
 */
export function preflightExactRecord(
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[] = [],
): InertRecord {
  const record = requirePlainRecord(value, path);
  const requiredSet = new Set(required);
  const allowed = new Set([...required, ...optional]);
  const present = new Set<string>();

  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== 'string') {
      reject(`${path} must not contain symbol keys`, path);
    }
    const keyPath = `${path}.${key}`;
    if (!allowed.has(key)) reject(`${keyPath} is not supported`, keyPath);
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (
      descriptor === undefined
      || descriptor.enumerable !== true
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ) {
      reject(`${keyPath} must be an enumerable own data property`, keyPath);
    }
    if (descriptor.value === undefined) {
      reject(`${keyPath} must be omitted rather than undefined`, keyPath);
    }
    present.add(key);
  }

  for (const key of requiredSet) {
    if (!present.has(key)) reject(`${path}.${key} is required`, `${path}.${key}`);
  }
  return record;
}

/** Reads only a property already accepted by preflightExactRecord. */
export function readInertOwnValue(record: InertRecord, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ? descriptor.value
    : undefined;
}

/** Validates dense JSON-style array indices without reading indexed properties. */
export function preflightDenseArray(
  value: unknown,
  path: string,
  maximumLength = Number.MAX_SAFE_INTEGER,
): unknown[] {
  if (!Array.isArray(value)) reject(`${path} must be an array`, path);
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    reject(`${path} must use the plain Array prototype`, path);
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (
    lengthDescriptor === undefined
    || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')
    || !Number.isSafeInteger(lengthDescriptor.value)
    || lengthDescriptor.value < 0
  ) {
    reject(`${path}.length must be a safe array length`, `${path}.length`);
  }
  const length = lengthDescriptor.value as number;
  if (length > maximumLength) {
    reject(`${path} exceeds its maximum length of ${maximumLength}`, path);
  }

  const present = new Set<number>();
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key)) {
      reject(`${path}.${String(key)} is not an array index`, `${path}.${String(key)}`);
    }
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index >= length) {
      reject(`${path}.${key} is outside the dense array`, `${path}.${key}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined
      || descriptor.enumerable !== true
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ) {
      reject(`${path}[${key}] must be an enumerable own data property`, `${path}[${key}]`);
    }
    if (descriptor.value === undefined) {
      reject(`${path}[${key}] must not be undefined`, `${path}[${key}]`);
    }
    present.add(index);
  }
  for (let index = 0; index < length; index += 1) {
    if (!present.has(index)) reject(`${path} must not contain sparse entries`, `${path}[${index}]`);
  }
  return value;
}
