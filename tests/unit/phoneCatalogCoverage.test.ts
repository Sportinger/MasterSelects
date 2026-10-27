// The phone catalog coverage table (PLAN M6): every catalog id has exactly one place on the phone,
// and every place exists in the real phone catalogs. M6 is reached: no id is an open gap any more.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PHONE_ACTIONS } from '../../src/components/mobileSkin/actions/phoneActionCatalog';
import { PHONE_ASSISTANT_TASKS } from '../../src/components/mobileSkin/assistant/phoneAssistantTasks';
import {
  PHONE_CATALOG_COVERAGE_BY_AREA, phoneCatalogCoverageCounts, phoneCatalogCoverageRows, phoneCatalogGaps,
} from '../../src/components/mobileSkin/catalog/phoneCatalogCoverage';
import { PHONE_CATALOG_ITEMS } from '../../src/components/mobileSkin/catalog/phoneCatalogIds.generated';
import type { PhoneCatalogTarget } from '../../src/components/mobileSkin/catalog/phoneCatalogTargets';
import { PHONE_PANELS } from '../../src/components/mobileSkin/panels/phonePanelCatalog';
import { PHONE_SHEET_REGISTRY } from '../../src/components/mobileSkin/sheets/phoneSheetRegistry';
import { PHONE_WORKSPACES } from '../../src/components/mobileSkin/workspace/phoneWorkspaceCatalog';

/** Ids the gap count may not exceed; lower it whenever a gap closes (never raise it). */
const KNOWN_GAP_BUDGET = 0;

/** Assistant-tier ids without an "Ask the assistant" task, each with the reason. */
const ASSISTANT_WITHOUT_TASK: Readonly<Record<string, string>> = {
  'INV-8/developer-bridge-test-command-accounting': 'developer-only bridge bookkeeping with no button by its own definition',
};

const SKIN_ROOT = resolve(__dirname, '../../src/components/mobileSkin');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'catalog' ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/**
 * Every test id string the phone source spells out, literally or as the fixed head of a template
 * (`phone-export-format-${id}` yields 'phone-export-format-'). The catalog folder itself is left out
 * so the table cannot vouch for its own ids.
 */
function knownTestIdHeads(): Set<string> {
  const heads = new Set<string>(['preview-canvas']);
  for (const file of sourceFiles(SKIN_ROOT)) {
    for (const match of readFileSync(file, 'utf8').matchAll(/['"`](phone-[a-z0-9-]+)/g)) heads.add(match[1]);
  }
  return heads;
}

const TEST_ID_HEADS = knownTestIdHeads();

/** A test id is real when the source spells it, or composes it from a specific head ('phone-x-…'). */
function isKnownTestId(testId: string): boolean {
  if (TEST_ID_HEADS.has(testId)) return true;
  for (const head of TEST_ID_HEADS) {
    if (!/^phone-[a-z0-9]+-/.test(head)) continue;
    const prefix = head.endsWith('-') ? head : `${head}-`;
    if (testId.startsWith(prefix) && testId.length > prefix.length) return true;
  }
  return false;
}

function targetProblem(id: string, target: PhoneCatalogTarget): string | null {
  switch (target.kind) {
    case 'action':
      return PHONE_ACTIONS.some((entry) => entry.id === target.id) ? null : `no phone action '${target.id}'`;
    case 'sheet':
      if (!Object.prototype.hasOwnProperty.call(PHONE_SHEET_REGISTRY, target.id)) return `no sheet '${target.id}'`;
      return target.testId && !isKnownTestId(target.testId) ? `unknown test id '${target.testId}'` : null;
    case 'panel':
      if (!PHONE_PANELS.some((entry) => entry.type === target.type)) return `panel '${target.type}' is not in All tools`;
      return target.tab && target.type !== 'clip-properties' ? 'a tab is only meaningful for the Properties panel' : null;
    case 'workspace':
      return PHONE_WORKSPACES.some((entry) => entry.id === target.id) ? null : `no landscape editor '${target.id}'`;
    case 'shell':
      if (!isKnownTestId(target.testId)) return `unknown test id '${target.testId}'`;
      return target.note.length >= 10 ? null : 'shell note too short';
    case 'assistant':
      if (PHONE_ASSISTANT_TASKS.some((task) => task.catalogId === id)) return null;
      return ASSISTANT_WITHOUT_TASK[id] ? null : 'no "Ask the assistant" task names this id';
    case 'exception':
      if (target.reason.trim().length < 20) return 'exception reason shorter than 20 characters';
      if (target.sheet && !Object.prototype.hasOwnProperty.call(PHONE_SHEET_REGISTRY, target.sheet)) return `no sheet '${target.sheet}'`;
      return isKnownTestId(target.testId) ? null : `unknown greyed control '${target.testId}'`;
    case 'gap':
      return target.note.trim().length >= 20 ? null : 'gap note shorter than 20 characters';
  }
}

describe('phone catalog coverage table', () => {
  it('has unique catalog ids in the generated data file', () => {
    const ids = PHONE_CATALOG_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(600);
  });

  it('maps every catalog id exactly once, in the table of its own area', () => {
    const catalog = new Map(PHONE_CATALOG_ITEMS.map((item) => [item.id, item]));
    const seen = new Map<string, string>();
    const problems: string[] = [];
    for (const [area, table] of Object.entries(PHONE_CATALOG_COVERAGE_BY_AREA)) {
      for (const id of Object.keys(table)) {
        const item = catalog.get(id);
        if (!item) problems.push(`${id}: not in the catalog`);
        else if (item.area !== area) problems.push(`${id}: listed under ${area}, belongs to ${item.area}`);
        if (seen.has(id)) problems.push(`${id}: mapped in ${seen.get(id)} and ${area}`);
        seen.set(id, area);
      }
    }
    for (const item of PHONE_CATALOG_ITEMS) if (!seen.has(item.id)) problems.push(`${item.id}: not mapped`);
    expect(problems).toEqual([]);
    expect(phoneCatalogCoverageRows()).toHaveLength(PHONE_CATALOG_ITEMS.length);
  });

  it('points every target at a real action, sheet, panel, editor, shell control, assistant task or greyed control', () => {
    const problems = phoneCatalogCoverageRows()
      .map(({ item, target }) => [item.id, targetProblem(item.id, target)] as const)
      .filter(([, problem]) => problem !== null)
      .map(([id, problem]) => `${id}: ${problem}`);
    expect(problems).toEqual([]);
  });

  it('keeps the assistant task list in step with the catalog', () => {
    const ids = new Set(PHONE_CATALOG_ITEMS.map((item) => item.id));
    expect(PHONE_ASSISTANT_TASKS.map((task) => task.catalogId).filter((id) => !ids.has(id))).toEqual([]);
  });

  it('gives every greyed exception a visible reason of at least 20 characters', () => {
    const exceptions = phoneCatalogCoverageRows().filter(({ target }) => target.kind === 'exception');
    expect(exceptions.length).toBeGreaterThan(0);
    for (const { target } of exceptions) {
      if (target.kind === 'exception') expect(target.reason.trim().length).toBeGreaterThanOrEqual(20);
    }
  });

  it('uses every kind of place at least once', () => {
    const counts = phoneCatalogCoverageCounts();
    for (const kind of ['action', 'sheet', 'panel', 'workspace', 'shell', 'assistant', 'exception'] as const) {
      expect(counts[kind], kind).toBeGreaterThan(0);
    }
  });

  it('never grows the number of open gaps', () => {
    const gapCount = Object.values(phoneCatalogGaps()).reduce((sum, list) => sum + list.length, 0);
    expect(gapCount).toBeLessThanOrEqual(KNOWN_GAP_BUDGET);
  });

  // PLAN M6 "done when the catalog has no open item".
  it('M6: the catalog has no open gap', () => {
    expect(phoneCatalogGaps()).toEqual({});
  });
});
