// Recursive node renderer - switches between split and tab-group

import { memo } from 'react';
import type { DockNode as DockNodeType } from '../../types/dock';
import { DockSplitPane } from './DockSplitPane';
import { DockTabPane } from './DockTabPane';

interface DockNodeProps {
  node: DockNodeType;
}

function DockNodeComponent({ node }: DockNodeProps) {
  if (node.kind === 'split') {
    return <DockSplitPane key={node.id} split={node} />;
  }
  return <DockTabPane key={node.id} group={node} />;
}

export const DockNode = memo(DockNodeComponent);
