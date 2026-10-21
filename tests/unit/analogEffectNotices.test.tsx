import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EffectBudgetNotice } from '../../src/components/panels/properties/EffectBudgetNotice';
import { getDefaultParams } from '../../src/effects';

afterEach(cleanup);

describe('analog effects say in the inspector what they clamp or cannot draw', () => {
  it('CRT Screen notes lines that are too fine for the frame and a clamped Mix', () => {
    render(<EffectBudgetNotice effectType="crt-screen" params={{ ...getDefaultParams('crt-screen'), lineCount: 1000, amount: 2 }} />);
    const notice = screen.getByRole('status').textContent ?? '';
    expect(notice).toMatch(/1000 lines are 1\.08 px apart; lines closer than 2\.25 px fade out/);
    expect(notice).toMatch(/Mix 2 is outside the rendered range 0 to 1 and renders as 1/);
  });

  it('shows nothing for default settings and for CRT effects on the original graph', () => {
    render(<EffectBudgetNotice effectType="crt-screen" params={getDefaultParams('crt-screen')} />);
    render(<EffectBudgetNotice effectType="crt-screen" params={{ scale: 3, amount: 3, speed: 1 }} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('Pixel Sort and Analog Signal Lab name out-of-range values', () => {
    render(<EffectBudgetNotice effectType="pixel-sort" params={{ ...getDefaultParams('pixel-sort'), scale: 40, threshold: 1.2 }} />);
    expect(screen.getByRole('status').textContent).toMatch(/Segment Size 40 is outside 4 to 16 pixels and renders as 16.*Threshold 1\.2/);
    cleanup();
    render(<EffectBudgetNotice effectType="analog-signal-lab" params={{ ...getDefaultParams('analog-signal-lab'), chromaLevel: 5, tuning: 3 }} />);
    const notice = screen.getByRole('status').textContent ?? '';
    expect(notice).toMatch(/Chroma Level 5 is outside 0 to 2 and renders as 2/);
    expect(notice).toMatch(/Fine Tuning 3 is outside -1 to 1; the signal model uses it as given/);
  });
});
