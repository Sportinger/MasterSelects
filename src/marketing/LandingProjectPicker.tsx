import { useEffect, useRef } from 'react';
import {
  IconChevronDown,
  IconChevronUp,
  IconFolderOpen,
  IconPlus,
} from '@tabler/icons-react';
import type { RecentProjectEntry } from '../services/projectFileService';

interface LandingProjectPickerProps {
  entering: boolean;
  exiting: boolean;
  mounted: boolean;
  onChooseNewProject?: () => Promise<void> | void;
  onOpenProject?: () => Promise<void> | void;
  onOpenRecentProject?: (projectId: string) => Promise<void> | void;
  openingProjectId: string | null;
  recentProjects: RecentProjectEntry[];
  selectedProjectId?: string | null;
}

function formatRecentProjectDate(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return 'Recent project';
  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(timestamp));
}

export function LandingProjectPicker({
  entering,
  exiting,
  mounted,
  onChooseNewProject,
  onOpenProject,
  onOpenRecentProject,
  openingProjectId,
  recentProjects,
  selectedProjectId,
}: LandingProjectPickerProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const projectSelectionPending = selectedProjectId === null;
  const projectCardCount = recentProjects.length
    + (onChooseNewProject ? 1 : 0)
    + (onOpenProject ? 1 : 0);
  const overflowClasses = [
    projectCardCount > 3 ? 'has-desktop-overflow' : '',
    projectCardCount > 2 ? 'has-tablet-overflow' : '',
    projectCardCount > 1 ? 'has-mobile-overflow' : '',
  ].filter(Boolean).join(' ');

  useEffect(() => {
    if (!projectSelectionPending || !mounted) return;
    const frame = window.requestAnimationFrame(() => {
      viewportRef.current?.scrollIntoView?.({ block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mounted, projectSelectionPending]);

  if (!mounted || (!onChooseNewProject && !onOpenProject && recentProjects.length === 0)) return null;

  const scrollProjects = (direction: -1 | 1) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollBy({
      behavior: 'smooth',
      top: direction * Math.max(120, viewport.clientHeight * 0.72),
    });
  };

  return (
    <section
      className={`landing-project-picker ${entering ? 'is-entering' : ''} ${exiting ? 'is-exiting' : ''}`.trim()}
      aria-label="Choose a project"
    >
      <div className="landing-project-picker-heading">
        <div>
          <p className="landing-eyebrow">Projects</p>
          <span>{projectSelectionPending ? 'Choose where to begin' : 'Switch project'}</span>
        </div>
        <div className="landing-project-picker-controls" aria-label="Scroll projects">
          <button type="button" aria-label="Previous projects" onClick={() => scrollProjects(-1)}>
            <IconChevronUp aria-hidden="true" />
          </button>
          <button type="button" aria-label="Next projects" onClick={() => scrollProjects(1)}>
            <IconChevronDown aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="landing-project-picker-fade">
        <div
          ref={viewportRef}
          className={`landing-project-picker-viewport ${overflowClasses}`.trim()}
          tabIndex={0}
        >
          <div className="landing-project-picker-track">
            {onChooseNewProject && (
              <button
                className={`landing-project-card is-new ${selectedProjectId === 'new' ? 'is-selected' : ''}`}
                type="button"
                disabled={openingProjectId !== null}
                onClick={() => void onChooseNewProject()}
              >
                <span className="landing-project-card-mark" aria-hidden="true"><IconPlus /></span>
                <span className="landing-project-card-copy"><strong>New project</strong><small>Empty canvas</small></span>
              </button>
            )}
            {onOpenProject && (
              <button
                className="landing-project-card is-open"
                type="button"
                disabled={openingProjectId !== null}
                onClick={() => void onOpenProject()}
              >
                <span className="landing-project-card-mark" aria-hidden="true">
                  <IconFolderOpen />
                </span>
                <span className="landing-project-card-copy">
                  <strong>Open project</strong>
                  <small>Choose a project folder</small>
                </span>
              </button>
            )}
            {recentProjects.map((project) => (
              <button
                className={`landing-project-card ${selectedProjectId === project.id ? 'is-selected' : ''}`}
                type="button"
                key={project.id}
                disabled={openingProjectId !== null}
                title={project.path || project.name}
                onClick={() => void onOpenRecentProject?.(project.id)}
              >
                <span className="landing-project-card-index" aria-hidden="true">
                  {project.backend === 'native' ? 'N' : 'F'}
                </span>
                <span className="landing-project-card-copy">
                  <strong>{project.name}</strong>
                  <small>
                    {openingProjectId === project.id
                      ? 'Opening…'
                      : formatRecentProjectDate(project.lastOpenedAt)}
                  </small>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
