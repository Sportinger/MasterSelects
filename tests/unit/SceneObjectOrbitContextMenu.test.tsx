import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SceneObjectOrbitContextMenu } from '../../src/components/preview/SceneObjectOrbitContextMenu';
import { SceneObjectHandles } from '../../src/components/preview/sceneOverlay/SceneOverlayChrome';
import type { DisplaySceneObject } from '../../src/components/preview/sceneOverlay/sceneOverlayTypes';

const object = {
  clipId: 'model-1',
  kind: 'model',
  name: 'Cube',
  displayX: 120,
  displayY: 80,
  screen: { x: 120, y: 80, visible: true },
} as DisplaySceneObject;

describe('scene object orbit context menu', () => {
  it('opens from a scene object handle context click', () => {
    const onContextMenu = vi.fn();
    render(
      <SceneObjectHandles
        objects={[object]}
        selectedClipId={null}
        orbitTargetClipId={null}
        mode="move"
        onPointerDown={vi.fn()}
        onDoubleClick={vi.fn()}
        onContextMenu={onContextMenu}
      />,
    );

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Cube' }));

    expect(onContextMenu).toHaveBeenCalledOnce();
    expect(onContextMenu.mock.calls[0]?.[1]).toBe(object);
  });

  it('chooses the clicked object as the orbit target', () => {
    const onOrbit = vi.fn();
    render(
      <SceneObjectOrbitContextMenu
        menu={{ x: 100, y: 80, clipId: object.clipId, name: object.name }}
        onClose={vi.fn()}
        onOrbit={onOrbit}
      />,
    );

    fireEvent.click(screen.getByRole('menuitem', { name: 'Orbit' }));

    expect(onOrbit).toHaveBeenCalledWith('model-1');
  });
});
