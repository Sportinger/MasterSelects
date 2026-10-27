// The phone catalog coverage table: every id of the phone feature catalog
// (phoneCatalogIds.generated.ts) mapped to where it lives on the phone. PLAN M6 is done when no
// id is a 'gap' any more. tests/unit/phoneCatalogCoverage.test.ts checks the table against the
// real action, sheet, panel and editor catalogs; tests/playwright/mobile/m6-coverage.spec.ts proves
// one entry per kind on a phone.

import { PHONE_CATALOG_ITEMS, type PhoneCatalogArea, type PhoneCatalogItem } from './phoneCatalogIds.generated';
import { PHONE_CATALOG_COVERAGE_INV1 } from './phoneCatalogCoverageInv1';
import { PHONE_CATALOG_COVERAGE_INV2 } from './phoneCatalogCoverageInv2';
import { PHONE_CATALOG_COVERAGE_INV3 } from './phoneCatalogCoverageInv3';
import { PHONE_CATALOG_COVERAGE_INV4 } from './phoneCatalogCoverageInv4';
import { PHONE_CATALOG_COVERAGE_INV5 } from './phoneCatalogCoverageInv5';
import { PHONE_CATALOG_COVERAGE_INV6 } from './phoneCatalogCoverageInv6';
import { PHONE_CATALOG_COVERAGE_INV7 } from './phoneCatalogCoverageInv7';
import { PHONE_CATALOG_COVERAGE_INV8 } from './phoneCatalogCoverageInv8';
import type { PhoneCatalogTarget, PhoneCatalogTargetKind } from './phoneCatalogTargets';

/** One table per catalog area; an id belongs in the table of its own area. */
export const PHONE_CATALOG_COVERAGE_BY_AREA: Readonly<Record<PhoneCatalogArea, Readonly<Record<string, PhoneCatalogTarget>>>> = {
  'INV-1': PHONE_CATALOG_COVERAGE_INV1,
  'INV-2': PHONE_CATALOG_COVERAGE_INV2,
  'INV-3': PHONE_CATALOG_COVERAGE_INV3,
  'INV-4': PHONE_CATALOG_COVERAGE_INV4,
  'INV-5': PHONE_CATALOG_COVERAGE_INV5,
  'INV-6': PHONE_CATALOG_COVERAGE_INV6,
  'INV-7': PHONE_CATALOG_COVERAGE_INV7,
  'INV-8': PHONE_CATALOG_COVERAGE_INV8,
};

export interface PhoneCatalogCoverageRow {
  item: PhoneCatalogItem;
  target: PhoneCatalogTarget;
}

/** Catalog item plus its target, in catalog order; items without a target are left out (the test names them). */
export function phoneCatalogCoverageRows(): PhoneCatalogCoverageRow[] {
  const rows: PhoneCatalogCoverageRow[] = [];
  for (const item of PHONE_CATALOG_ITEMS) {
    const target = PHONE_CATALOG_COVERAGE_BY_AREA[item.area][item.id];
    if (target) rows.push({ item, target });
  }
  return rows;
}

/** How many ids each kind of place holds. */
export function phoneCatalogCoverageCounts(rows = phoneCatalogCoverageRows()): Record<PhoneCatalogTargetKind, number> {
  const counts: Record<PhoneCatalogTargetKind, number> = {
    action: 0, sheet: 0, panel: 0, workspace: 0, shell: 0, assistant: 0, exception: 0, gap: 0,
  };
  for (const row of rows) counts[row.target.kind] += 1;
  return counts;
}

/** The open ids (real gaps: neither built nor greyed anywhere), grouped by area. */
export function phoneCatalogGaps(rows = phoneCatalogCoverageRows()): Record<string, Array<{ id: string; title: string; note: string }>> {
  const gaps: Record<string, Array<{ id: string; title: string; note: string }>> = {};
  for (const { item, target } of rows) {
    if (target.kind !== 'gap') continue;
    (gaps[item.area] ??= []).push({ id: item.id, title: item.title, note: target.note });
  }
  return gaps;
}
