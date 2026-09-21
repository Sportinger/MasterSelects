import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NodeGraphNodeCard } from '../../src/components/panels/nodes/canvas/NodeGraphNodeCard';
import type { NodeGraphNode } from '../../src/types/nodeGraph';

const node = (operatorId: string): NodeGraphNode => ({
  id: 'math-node', operatorId, label: 'Subtract', kind: 'effect', runtime: 'builtin',
  inputs: [], outputs: [], layout: { x: 0, y: 0 },
});

describe('MathNodeMode', () => {
  it.each(['image.luminance', 'math.subtract.scalar', 'math.subtract'])('keeps operation controls off node cards for %s', operatorId => {
    render(<NodeGraphNodeCard node={node(operatorId)} clipId="clip-image" selectedNodeId={null} connectionDraft={null}
      onSelectNode={() => {}} onStartNodeDrag={() => {}} onNodePointerMove={() => {}} onFinishNodeDrag={() => {}}
      onStartConnectionDrag={() => {}} onDisconnectPortEdges={() => {}} />);
    expect(screen.queryByLabelText('Math operation for Subtract')).toBeNull();
  });
});
