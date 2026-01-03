// Recursive node renderer - switches between split and tab-group

import type { DockNode as DockNodeType } from '../../types/dock';
import { DockSplitPane } from './DockSplitPane';
import { DockTabPane } from './DockTabPane';

interface DockNodeProps {
  node: DockNodeType;
}

export function DockNode({ node }: DockNodeProps) {
  if (node.kind === 'split') {
    return <DockSplitPane split={node} />;
  }
  return <DockTabPane group={node} />;
}
