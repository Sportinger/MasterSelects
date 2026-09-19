import {
  IconAdjustmentsHorizontal,
  IconColorFilter,
  IconHierarchy3,
  IconMovie,
  IconPhoto,
  IconShare3,
  IconTimeline,
  type Icon,
} from '@tabler/icons-react';
import { useCallback } from 'react';

import { useDockStore } from '../../../stores/dockStore';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import type { ColorWorkspaceTogglePanel } from './colorWorkspacePanelLayout';
import {
  isColorWorkspacePanelVisible,
  toggleColorWorkspacePanel,
} from './colorWorkspacePanelLayout';
import './ColorWorkspaceTopBar.css';

interface ColorWorkspaceTopBarButtonProps {
  active?: boolean;
  disabled?: boolean;
  icon: Icon;
  label: string;
  onClick?: () => void;
}

function ColorWorkspaceTopBarButton({
  active = false,
  disabled = false,
  icon: ButtonIcon,
  label,
  onClick,
}: ColorWorkspaceTopBarButtonProps) {
  return (
    <button
      type="button"
      className={`color-workspace-top-bar-button ${active ? 'active' : ''}`}
      aria-label={label}
      aria-pressed={disabled ? undefined : active}
      disabled={disabled}
      title={disabled ? `${label} (coming soon)` : label}
      onClick={onClick}
    >
      <ButtonIcon aria-hidden="true" stroke={1.45} />
    </button>
  );
}

export function ColorWorkspaceTopBar() {
  const layout = useDockStore(state => state.layout);
  const storedProjectName = useMediaStore(state => state.currentProjectName);
  const videoTrackCount = useTimelineStore(state => (
    state.tracks.filter(track => track.type === 'video').length
  ));
  const projectName = typeof storedProjectName === 'string' && storedProjectName.trim()
    ? storedProjectName
    : 'Untitled Project';

  const togglePanel = useCallback((type: ColorWorkspaceTogglePanel) => {
    const wasVisible = isColorWorkspacePanelVisible(useDockStore.getState().layout, type);
    const colorRootHeight = document
      .querySelector<HTMLElement>('[data-split-id="color-root-split"]')
      ?.getBoundingClientRect().height;
    useDockStore.setState(state => ({
      layout: toggleColorWorkspacePanel(state.layout, type, {
        rootHeight: colorRootHeight,
        videoTrackCount,
      }),
    }));

    if (!wasVisible) {
      useDockStore.getState().activatePanelType(type);
      if (type === 'clip-properties') {
        requestAnimationFrame(() => {
          window.setTimeout(() => {
            window.dispatchEvent(new CustomEvent('openPropertiesTab', {
              detail: { tab: 'effects' },
            }));
          }, 50);
        });
      }
    }
  }, [videoTrackCount]);

  const isVisible = (type: ColorWorkspaceTogglePanel) => (
    isColorWorkspacePanelVisible(layout, type)
  );

  return (
    <nav className="color-workspace-top-bar" aria-label="Color workspace panels">
      <div className="color-workspace-top-bar-group color-workspace-top-bar-group--left">
        <ColorWorkspaceTopBarButton disabled icon={IconColorFilter} label="LUTs" />
        <ColorWorkspaceTopBarButton
          active={isVisible('media')}
          icon={IconPhoto}
          label="Media"
          onClick={() => togglePanel('media')}
        />
        <ColorWorkspaceTopBarButton
          active={isVisible('color-clips')}
          icon={IconMovie}
          label="Clips"
          onClick={() => togglePanel('color-clips')}
        />
      </div>

      <strong className="color-workspace-top-bar-project" title={projectName}>
        {projectName}
      </strong>

      <div className="color-workspace-top-bar-group color-workspace-top-bar-group--right">
        <ColorWorkspaceTopBarButton disabled icon={IconShare3} label="Export" />
        <ColorWorkspaceTopBarButton
          active={isVisible('color-timeline')}
          icon={IconTimeline}
          label="Mini Timeline"
          onClick={() => togglePanel('color-timeline')}
        />
        <ColorWorkspaceTopBarButton
          active={isVisible('color-nodes')}
          icon={IconHierarchy3}
          label="Node Graph"
          onClick={() => togglePanel('color-nodes')}
        />
        <ColorWorkspaceTopBarButton
          active={isVisible('clip-properties')}
          icon={IconAdjustmentsHorizontal}
          label="Properties: Effects"
          onClick={() => togglePanel('clip-properties')}
        />
      </div>
    </nav>
  );
}
