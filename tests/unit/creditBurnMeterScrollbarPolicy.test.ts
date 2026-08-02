import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function readCreditBurnMeterCss(): string {
  return readFileSync(join(process.cwd(), 'src/components/common/CreditBurnMeter.css'), 'utf8');
}

describe('credit burn meter scrollbar policy', () => {
  it('animates the active sheen without changing scrollable geometry', () => {
    const css = readCreditBurnMeterCss();
    const activeSheenRule = css.match(
      /\.credit-burn-meter\.is-active::after\s*\{([\s\S]*?)\n\}/,
    )?.[1] ?? '';
    const activeSheenKeyframes = css.match(
      /@keyframes credit-active-sheen\s*\{([\s\S]*?)\n\}/,
    )?.[1] ?? '';

    expect(activeSheenRule).toContain('background:');
    expect(activeSheenRule).toContain('260% 100%');
    expect(activeSheenRule).not.toMatch(/\btransform\s*:/);
    expect(activeSheenKeyframes).toContain('background-position:');
    expect(activeSheenKeyframes).not.toMatch(/\btransform\s*:/);
  });
});
