// Split container with two children and resize handle

import { useCallback, useState, useEffect } from 'react';
import type { DockSplit } from '../../types/dock';
import { useDockStore } from '../../stores/dockStore';
import { DockNode } from './DockNode';

interface DockSplitPaneProps {
  split: DockSplit;
}

export function DockSplitPane({ split }: DockSplitPaneProps) {
  const { setSplitRatio } = useDockStore();
  const [isResizing, setIsResizing] = useState(false);

  const isHorizontal = split.direction === 'horizontal';

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const container = document.querySelector(`[data-split-id="${split.id}"]`);
      if (!container) return;

      const rect = container.getBoundingClientRect();
      let ratio: number;

      if (isHorizontal) {
        ratio = (e.clientX - rect.left) / rect.width;
      } else {
        ratio = (e.clientY - rect.top) / rect.height;
      }

      setSplitRatio(split.id, ratio);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, isHorizontal, split.id, setSplitRatio]);

  const firstChildStyle = {
    [isHorizontal ? 'width' : 'height']: `calc(${split.ratio * 100}% - 2px)`,
  };

  const secondChildStyle = {
    [isHorizontal ? 'width' : 'height']: `calc(${(1 - split.ratio) * 100}% - 2px)`,
  };

  return (
    <div
      className={`dock-split ${isHorizontal ? 'horizontal' : 'vertical'} ${isResizing ? 'resizing' : ''}`}
      data-split-id={split.id}
    >
      <div className="dock-split-child" style={firstChildStyle}>
        <DockNode node={split.children[0]} />
      </div>
      <div
        className={`dock-resize-handle ${isHorizontal ? 'horizontal' : 'vertical'}`}
        onMouseDown={handleMouseDown}
      />
      <div className="dock-split-child" style={secondChildStyle}>
        <DockNode node={split.children[1]} />
      </div>
    </div>
  );
}
