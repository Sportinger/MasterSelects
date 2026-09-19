import {
  IconActivity,
  IconAdjustmentsHorizontal,
  IconBlur,
  IconChartLine,
  IconCircleDashed,
  IconColorPicker,
  IconColorSwatch,
  IconDropletHalf2,
  IconHexagon,
  IconKey,
  IconLayersIntersect,
  IconMaximize,
  IconSunHigh,
  IconTargetArrow,
  IconWaveSine,
  type Icon,
} from '@tabler/icons-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { ColorEditor } from '../color/ColorEditor';
import { ColorCurvesPanel } from './ColorCurvesPanel';

type ColorToolMode =
  | 'primaries'
  | 'hdr'
  | 'rgb-mixer'
  | 'motion-effects'
  | 'curves'
  | 'color-slice'
  | 'color-warper'
  | 'qualifier'
  | 'window'
  | 'tracker'
  | 'blur'
  | 'key'
  | 'sizing';

interface ColorToolDefinition {
  id: ColorToolMode;
  label: string;
  icon: Icon;
  available: boolean;
}

const COLOR_TOOLS: ColorToolDefinition[] = [
  { id: 'primaries', label: 'Primaries', icon: IconColorSwatch, available: true },
  { id: 'hdr', label: 'HDR Wheels', icon: IconSunHigh, available: false },
  { id: 'rgb-mixer', label: 'RGB Mixer', icon: IconAdjustmentsHorizontal, available: false },
  { id: 'motion-effects', label: 'Motion Effects', icon: IconActivity, available: false },
  { id: 'curves', label: 'Custom Curves', icon: IconChartLine, available: true },
  { id: 'color-slice', label: 'Color Slice', icon: IconDropletHalf2, available: false },
  { id: 'color-warper', label: 'Color Warper', icon: IconHexagon, available: false },
  { id: 'qualifier', label: 'Qualifier', icon: IconColorPicker, available: false },
  { id: 'window', label: 'Power Windows', icon: IconCircleDashed, available: false },
  { id: 'tracker', label: 'Tracker', icon: IconTargetArrow, available: false },
  { id: 'blur', label: 'Blur', icon: IconBlur, available: false },
  { id: 'key', label: 'Node Key', icon: IconKey, available: false },
  { id: 'sizing', label: 'Sizing', icon: IconMaximize, available: false },
];

interface ColorToolDockProps {
  auxMode: ColorAuxMode;
  clipId: string;
  clipName: string;
  onAuxModeChange: (mode: ColorAuxMode) => void;
}

export type ColorAuxMode = 'keyframes' | 'scopes';

export function ColorToolDock({ auxMode, clipId, clipName, onAuxModeChange }: ColorToolDockProps) {
  const [activeTool, setActiveTool] = useState<ColorToolMode>('primaries');
  const [isMiddleDragging, setIsMiddleDragging] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const middleDragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startScrollLeft: number;
  } | null>(null);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return undefined;

    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;

      const maxScrollLeft = nav.scrollWidth - nav.clientWidth;
      if (maxScrollLeft <= 0) return;

      const rawDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX)
        ? event.deltaY
        : event.deltaX;
      if (rawDelta === 0) return;

      const deltaScale = event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? nav.clientWidth
          : 1;
      const nextScrollLeft = Math.max(
        0,
        Math.min(maxScrollLeft, nav.scrollLeft + rawDelta * deltaScale),
      );
      if (nextScrollLeft === nav.scrollLeft) return;

      event.preventDefault();
      event.stopPropagation();
      nav.scrollLeft = nextScrollLeft;
    };

    nav.addEventListener('wheel', handleWheel, { passive: false });
    return () => nav.removeEventListener('wheel', handleWheel);
  }, []);

  const handleNavPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 1) return;

    event.preventDefault();
    event.stopPropagation();
    middleDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startScrollLeft: event.currentTarget.scrollLeft,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setIsMiddleDragging(true);
  }, []);

  const handleNavPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = middleDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.currentTarget.scrollLeft = drag.startScrollLeft - (event.clientX - drag.startClientX);
  }, []);

  const finishMiddleDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = middleDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    middleDragRef.current = null;
    setIsMiddleDragging(false);
  }, []);

  return (
    <section className="color-tool-dock">
      <nav
        aria-label="Color tools"
        className={`color-tool-dock-nav${isMiddleDragging ? ' is-middle-dragging' : ''}`}
        onPointerCancel={finishMiddleDrag}
        onPointerDownCapture={handleNavPointerDown}
        onPointerMove={handleNavPointerMove}
        onPointerUp={finishMiddleDrag}
        ref={navRef}
      >
        {COLOR_TOOLS.map(tool => {
          const ToolIcon = tool.icon;
          return (
            <button
              aria-current={activeTool === tool.id ? 'page' : undefined}
              className={activeTool === tool.id ? 'active' : undefined}
              disabled={!tool.available}
              key={tool.id}
              onClick={() => setActiveTool(tool.id)}
              title={tool.available ? tool.label : `${tool.label} · adapter pending`}
              type="button"
            >
              <ToolIcon aria-hidden="true" className="color-tool-dock-icon" size={30} stroke={1.5} />
              {tool.id === 'curves' && <i aria-hidden="true" className="color-tool-dock-indicator" />}
              <span>{tool.label}</span>
            </button>
          );
        })}
        <span aria-hidden="true" className="color-tool-dock-nav-spacer" />
        <button
          aria-current={auxMode === 'keyframes' ? 'page' : undefined}
          className={`color-tool-dock-nav-status${auxMode === 'keyframes' ? ' active' : ''}`}
          onClick={() => onAuxModeChange('keyframes')}
          title="Keyframes"
          type="button"
        >
          <IconLayersIntersect size={29} stroke={1.45} />
        </button>
        <button
          aria-current={auxMode === 'scopes' ? 'page' : undefined}
          className={`color-tool-dock-nav-status${auxMode === 'scopes' ? ' active' : ''}`}
          onClick={() => onAuxModeChange('scopes')}
          title="Scopes"
          type="button"
        >
          <IconWaveSine size={30} stroke={1.5} />
        </button>
      </nav>

      <div className="color-tool-dock-content">
        {activeTool === 'primaries' && (
          <section className="color-workspace-wheels">
            <header className="color-workspace-surface-header">
              <strong>Primaries · Color Wheels</strong>
              <span>{clipName}</span>
            </header>
            <div className="color-workspace-wheels-content">
              <ColorEditor clipId={clipId} controlSet="wheels" surface="controls" />
            </div>
          </section>
        )}
        {activeTool === 'curves' && <ColorCurvesPanel clipId={clipId} />}
      </div>
    </section>
  );
}
