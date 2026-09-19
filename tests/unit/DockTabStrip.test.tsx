import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DockTabStrip } from '../../src/components/dock/tabPane/DockTabStrip';
import type { DockTabGroup } from '../../src/types/dock';

const MOBILE_TOOL_GROUP: DockTabGroup = {
  kind: 'tab-group',
  id: 'mobile-v-tools-group',
  panels: [
    { id: 'media', type: 'media', title: 'Media' },
    { id: 'properties', type: 'clip-properties', title: 'Properties' },
  ],
  activeIndex: 0,
};

function renderTabStrip(group: DockTabGroup) {
  const noop = vi.fn();

  render(
    <DockTabStrip
      group={group}
      tabBarRef={createRef<HTMLDivElement>()}
      isMiddleDragging={false}
      groupContainsMaximizedPanel={false}
      hasTimelinePanel={false}
      timelinePanel={null}
      openCompositions={[]}
      slotGridProgress={0}
      holdingTabId={null}
      holdProgress="idle"
      draggedCompIndex={null}
      dropTargetIndex={null}
      activeCompositionId={null}
      hoveredTabTarget={null}
      hoveredPanelId={null}
      maximizedPanelId={null}
      dragState={{
        isDragging: false,
        draggedPanel: null,
        sourceGroupId: null,
        sourceFloatingId: null,
        dropTarget: null,
        dragOffset: { x: 0, y: 0 },
        currentPos: { x: 0, y: 0 },
        lastDropCommitted: false,
      }}
      selectedSlotName={null}
      selectedPropertiesName={null}
      audioMixerTabStats={{ label: 'Audio Mixer', title: 'Audio Mixer' }}
      addMenuOpen={false}
      onTabBarMouseDown={noop}
      onTabBarContextMenu={noop}
      onTimelineHandlePointerDown={noop}
      onTimelineHandleContextMenu={noop}
      onTimelineHandlePointerUp={noop}
      onTimelineHandlePointerLeave={noop}
      onCompositionClick={noop}
      onCompositionClose={noop}
      onCompositionTabMouseEnter={noop}
      onCompositionTabMouseLeave={noop}
      compositionTabHandlers={{
        onDragStart: noop,
        onDragOver: noop,
        onDragLeave: noop,
        onDrop: noop,
        onDragEnd: noop,
      }}
      onTabClick={noop}
      onTabPointerDown={noop}
      onTabContextMenu={noop}
      onTabPointerUp={noop}
      onTabPointerLeave={noop}
      onTabPointerCancel={noop}
      onPanelTabMouseEnter={noop}
      onPanelTabMouseLeave={noop}
      onAddButtonClick={noop}
    />,
  );
}

describe('DockTabStrip', () => {
  it('places the add-panel button directly after the active vertical-mobile tab', () => {
    renderTabStrip(MOBILE_TOOL_GROUP);

    const activeTab = screen.getByRole('tab', { name: 'Media' });
    const addButton = screen.getByRole('button', { name: 'Add panel' });

    expect(activeTab.nextElementSibling).toBe(addButton);
  });
});
