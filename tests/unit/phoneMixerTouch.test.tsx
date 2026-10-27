import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MixerVolumeFader } from '../../src/components/panels/audio-mixer/MixerVolumeFader';

function pointer(type: string, init: { pointerType: string; clientY: number; target: Element }) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientY: init.clientY });
  Object.defineProperty(event, 'pointerType', { value: init.pointerType });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  init.target.dispatchEvent(event);
}

function renderFader() {
  const onBeginDrag = vi.fn();
  const onChange = vi.fn();
  const { container } = render(
    <MixerVolumeFader value={0} ariaLabel="Track volume" onBeginDrag={onBeginDrag} onEndDrag={vi.fn()} onChange={onChange} />,
  );
  const root = container.querySelector('.audio-mixer-strip-fader') as HTMLDivElement;
  const thumb = container.querySelector('.audio-mixer-strip-fader-thumb') as HTMLSpanElement;
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, width: 30, height: 234, right: 30, bottom: 234, toJSON: () => ({}) });
  return { root, thumb, onBeginDrag, onChange };
}

describe('mixer fader on touch (phone editor)', () => {
  it('a finger anywhere on the fader drags it relatively from its value', () => {
    const { root, onBeginDrag, onChange } = renderFader();
    pointer('pointerdown', { pointerType: 'touch', clientY: 200, target: root });
    expect(onBeginDrag).toHaveBeenCalledTimes(1);
    pointer('pointermove', { pointerType: 'touch', clientY: 100, target: root });
    // 100 px up over a 200 px travel (234 - 34 px cap) of a 78 dB range: +39 dB, clamped to +18.
    expect(onChange).toHaveBeenLastCalledWith(18);
  });

  it('the mouse still has to grab the cap', () => {
    const { root, thumb, onBeginDrag } = renderFader();
    pointer('pointerdown', { pointerType: 'mouse', clientY: 200, target: root });
    expect(onBeginDrag).not.toHaveBeenCalled();
    pointer('pointerdown', { pointerType: 'mouse', clientY: 100, target: thumb });
    expect(onBeginDrag).toHaveBeenCalledTimes(1);
  });

  it('a pen keeps the desktop rule too', () => {
    const { root, onBeginDrag } = renderFader();
    pointer('pointerdown', { pointerType: 'pen', clientY: 200, target: root });
    expect(onBeginDrag).not.toHaveBeenCalled();
  });
});
