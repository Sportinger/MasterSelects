import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MathNodeMode } from '../../src/components/panels/nodes/previews/MathNodeMode';
import type { NodeGraphNode } from '../../src/types/nodeGraph';

const node = (operatorId: string): NodeGraphNode => ({
  id: 'math-node', operatorId, label: 'Subtract', kind: 'effect', runtime: 'builtin',
  inputs: [], outputs: [], layout: { x: 0, y: 0 },
});

describe('MathNodeMode', () => {
  it.each(['image.luminance'])('does not show a misleading scalar-field selector for %s', operatorId => {
    render(<MathNodeMode node={node(operatorId)} clipId="clip-image" />);
    expect(screen.queryByLabelText('Math operation for Subtract')).toBeNull();
  });

  it('shows only executable scalar variants for local image arithmetic', () => {
    render(<MathNodeMode node={node('math.subtract.scalar')} clipId="clip-image" />);
    fireEvent.click(screen.getByLabelText('Math operation for Subtract'));
    expect(screen.getByRole('option', { name: 'Add' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Constant' })).toBeNull();
  });

  it('continues to expose executable scalar-field math modes', () => {
    render(<MathNodeMode node={node('math.subtract')} clipId="clip-voxel" />);
    const operation = screen.getByLabelText('Math operation for Subtract');
    expect(operation).toHaveTextContent('Subtract');
    fireEvent.click(operation);
    expect(screen.getByRole('option', { name: 'Constant' })).toBeTruthy();
  });
});
