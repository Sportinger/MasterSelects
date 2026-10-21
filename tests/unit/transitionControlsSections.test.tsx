import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TransitionControlsSections } from '../../src/components/panels/properties/TransitionControlsSections';
import { crossfade } from '../../src/transitions/crossfade';
import type { TimelineTransition } from '../../src/types/timelineCore';

afterEach(cleanup);

function renderCrossfade(params: Record<string, unknown> = {}) {
  const onUpdateParam = vi.fn();
  const transition = { id: 'x', type: 'crossfade', duration: 1, linkedClipId: 'b', params } as TimelineTransition;
  const view = render(
    <TransitionControlsSections
      definition={crossfade}
      transition={transition}
      duration={1}
      bodyStart={3.5}
      bodyEnd={4.5}
      realHandleDuration={1}
      holdDuration={0}
      isAudioOnlyTransition={false}
      handledParamIds={new Set()}
      outgoingClip={null}
      getMediaDuration={() => undefined}
      onUpdateDuration={vi.fn()}
      onUpdateParam={onUpdateParam}
    />,
  );
  return { onUpdateParam, view };
}

it('toggles Include audio from its label text and from anywhere in the control cell', () => {
  const { onUpdateParam, view } = renderCrossfade();
  const checkbox = screen.getByRole('checkbox', { name: 'Include audio' });
  fireEvent.click(screen.getByText('Include audio'));
  expect(onUpdateParam).toHaveBeenLastCalledWith('includeAudio', true);
  fireEvent.click(view.container.querySelector('.transition-param-toggle')!);
  expect(onUpdateParam).toHaveBeenCalledTimes(2);
  // The keyboard still reaches the checkbox itself.
  checkbox.focus();
  expect(document.activeElement).toBe(checkbox);
});
