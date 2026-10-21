import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function rowColumns(): string {
  const css = readFileSync(join(process.cwd(), 'src/components/panels/properties/resolveInspector/ResolveInspector.css'), 'utf8');
  const rule = css.match(/\n {2}\.resolve-inspector-row \{([\s\S]*?)\n {2}\}/)?.[1] ?? '';
  return rule.match(/grid-template-columns:([\s\S]*?);/)?.[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim() ?? '';
}

describe('resolve inspector row columns', () => {
  it('lets the control column shrink so indented rows keep their reset button inside the card', () => {
    // Grouped effect parameters (Acuarela's Paint/Paper/Motion) sit in a nested section that is
    // narrower than the panel the container queries measure: a fixed control width overflowed.
    expect(rowColumns()).toBe('var(--resolve-inspector-label-width) var(--resolve-inspector-label-control-gap) '
      + 'minmax(0, var(--resolve-inspector-control-width)) minmax(var(--resolve-inspector-control-action-gap), 1fr) '
      + 'var(--resolve-inspector-action-width)');
  });
});
