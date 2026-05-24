export type CsvValueType = 'empty' | 'number' | 'boolean' | 'string' | 'mixed';

export interface CsvColumnSummary {
  name: string;
  index: number;
  type: CsvValueType;
  emptyCount: number;
}

export interface CsvParseResult {
  delimiter: string;
  columns: CsvColumnSummary[];
  rows: Record<string, string>[];
  rowCount: number;
  diagnostics: string[];
}

function normalizeHeaderCell(value: string, index: number, usedNames: Set<string>): string {
  const trimmed = value.trim();
  const base = trimmed || `column_${index + 1}`;
  let candidate = base;
  let suffix = 2;

  while (usedNames.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }

  usedNames.add(candidate);
  return candidate;
}

function parseCsvRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      records.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    records.push(row);
  }

  return records;
}

function classifyValue(value: string): CsvValueType {
  const trimmed = value.trim();
  if (!trimmed) return 'empty';
  if (/^(true|false)$/i.test(trimmed)) return 'boolean';
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) return 'number';
  return 'string';
}

function mergeValueTypes(types: CsvValueType[]): CsvValueType {
  const nonEmpty = types.filter((type) => type !== 'empty');
  if (nonEmpty.length === 0) return 'empty';

  const first = nonEmpty[0];
  return nonEmpty.every((type) => type === first) ? first : 'mixed';
}

export function parseCsv(text: string, delimiter = ','): CsvParseResult {
  const diagnostics: string[] = [];
  const records = parseCsvRecords(text.replace(/^\uFEFF/, ''), delimiter)
    .filter((row) => row.some((cell) => cell.trim().length > 0));

  if (records.length === 0) {
    diagnostics.push('CSV file is empty.');
    return { delimiter, columns: [], rows: [], rowCount: 0, diagnostics };
  }

  const header = records[0] ?? [];
  const usedNames = new Set<string>();
  const columnCount = Math.max(...records.map((row) => row.length));
  const columns = Array.from({ length: columnCount }, (_, index) => (
    normalizeHeaderCell(header[index] ?? '', index, usedNames)
  ));

  const dataRows = records.slice(1);
  const rows = dataRows.map((record) => (
    Object.fromEntries(columns.map((column, index) => [column, record[index] ?? '']))
  ));

  const summaries = columns.map<CsvColumnSummary>((name, index) => {
    const values = dataRows.map((row) => row[index] ?? '');
    return {
      name,
      index,
      type: mergeValueTypes(values.map(classifyValue)),
      emptyCount: values.filter((value) => value.trim().length === 0).length,
    };
  });

  return {
    delimiter,
    columns: summaries,
    rows,
    rowCount: rows.length,
    diagnostics,
  };
}
