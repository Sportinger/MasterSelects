#!/usr/bin/env node
// Generates src/components/mobileSkin/catalog/phoneCatalogIds.generated.ts from the phone
// feature catalog (katalog-INV-1.md … katalog-INV-8.md plus ergaenzungen.md, the maintainer's
// plan notes that are not part of this repository). The generated file is the source of truth
// for the catalog coverage test; rerun this script when the catalog changes:
//
//   node scripts/generate-phone-catalog-ids.mjs <path-to-katalog-folder>
//
// Each catalog entry is a line of the form
//   **Title** · `item-id` · Ebene: <tier> · …
// under a "### M<n> …" milestone heading. Entries of ergaenzungen.md name their area with
// "Bereich INV-<n>".

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TIERS = {
  'core': 'core',
  'Direkt': 'core',
  'Profi-Blatt': 'pro-sheet',
  'Querformat': 'landscape',
  'Assistent': 'assistant',
  'Ausnahme (ausgegraut)': 'exception',
};

const folder = process.argv[2];
if (!folder) {
  console.error('Usage: node scripts/generate-phone-catalog-ids.mjs <path-to-katalog-folder>');
  process.exit(1);
}

const files = readdirSync(folder)
  .filter((name) => /^katalog-INV-\d\.md$/.test(name))
  .toSorted();
if (files.length === 0) {
  console.error(`No katalog-INV-*.md files in ${folder}`);
  process.exit(1);
}
files.push('ergaenzungen.md');

const entries = [];
for (const file of files) {
  const fileArea = /INV-(\d)/.exec(file)?.[1];
  let milestone = null;
  for (const line of readFileSync(join(folder, file), 'utf8').split('\n')) {
    const heading = /^### (M\d)\b/.exec(line);
    if (heading) {
      milestone = heading[1];
      continue;
    }
    const entry = /^\*\*(.*?)\*\* · `([^`]+)` · Ebene: ([^·]+?)\s*·(.*)$/.exec(line);
    if (!entry) continue;
    const area = fileArea ?? /Bereich INV-(\d)/.exec(entry[4])?.[1];
    const tier = TIERS[entry[3].trim()];
    if (!area || !tier || !milestone) {
      console.error(`Cannot read entry in ${file}: ${line}`);
      process.exit(1);
    }
    entries.push({
      id: `INV-${area}/${entry[2]}`,
      area: `INV-${area}`,
      milestone,
      tier,
      title: entry[1],
      source: file === 'ergaenzungen.md' ? 'gap-review' : 'inventory',
    });
  }
}

const ids = new Set();
for (const entry of entries) {
  if (ids.has(entry.id)) {
    console.error(`Duplicate catalog id ${entry.id}`);
    process.exit(1);
  }
  ids.add(entry.id);
}

const body = entries
  .map((entry) => `  { id: ${JSON.stringify(entry.id)}, area: '${entry.area}', milestone: '${entry.milestone}', tier: '${entry.tier}', source: '${entry.source}', title: ${JSON.stringify(entry.title)} },`)
  .join('\n');

const output = `// GENERATED FILE - do not edit by hand.
// Generator: scripts/generate-phone-catalog-ids.mjs (node scripts/generate-phone-catalog-ids.mjs <katalog folder>).
// Every feature of the phone catalog (katalog-INV-1..8 plus the gap review), ${entries.length} ids. Titles stay
// in the catalog's language (German). phoneCatalogCoverage.ts maps each id to its place on the phone.

export type PhoneCatalogArea = 'INV-1' | 'INV-2' | 'INV-3' | 'INV-4' | 'INV-5' | 'INV-6' | 'INV-7' | 'INV-8';
export type PhoneCatalogTier = 'core' | 'pro-sheet' | 'landscape' | 'assistant' | 'exception';

export interface PhoneCatalogItem {
  id: string;
  area: PhoneCatalogArea;
  milestone: 'M0' | 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'M6';
  tier: PhoneCatalogTier;
  /** 'inventory' = katalog-INV-n.md, 'gap-review' = ergaenzungen.md. */
  source: 'inventory' | 'gap-review';
  title: string;
}

export const PHONE_CATALOG_ITEMS: readonly PhoneCatalogItem[] = [
${body}
];
`;

const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'components', 'mobileSkin', 'catalog', 'phoneCatalogIds.generated.ts');
writeFileSync(target, output);
console.log(`Wrote ${entries.length} catalog ids to ${target}`);
