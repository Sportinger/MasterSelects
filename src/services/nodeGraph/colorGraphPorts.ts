import type { ColorNode } from '../../types/colorCorrection';
import type { NodeGraphPort } from '../../types/nodeGraph';

export function colorPortSignal(portId: string): 'texture' | 'mask' {
  return portId.startsWith('key-') ? 'mask' : 'texture';
}

export function colorNodePorts(node: ColorNode): { inputs: NodeGraphPort[]; outputs: NodeGraphPort[] } {
  const textureInput = (id = 'in', label = 'Image'): NodeGraphPort => ({
    id, label, type: 'texture', direction: 'input',
  });
  const textureOutput = (id = 'out', label = 'Image'): NodeGraphPort => ({
    id, label, type: 'texture', direction: 'output',
  });
  const keyInput = (id = 'key-in', label = 'Key'): NodeGraphPort => ({
    id, label, type: 'mask', direction: 'input',
  });
  const keyOutput = (id = 'key-out', label = 'Key'): NodeGraphPort => ({
    id, label, type: 'mask', direction: 'output',
  });

  switch (node.type) {
    case 'input':
    case 'source':
      return { inputs: [], outputs: [textureOutput()] };
    case 'output':
      return { inputs: [textureInput()], outputs: [] };
    case 'alpha-output':
      return { inputs: [keyInput()], outputs: [] };
    case 'key-mixer':
      return {
        inputs: [keyInput('key-in', 'Key 1'), keyInput('key-in-2', 'Key 2')],
        outputs: [keyOutput()],
      };
    case 'parallel-mixer':
    case 'layer-mixer':
      return {
        inputs: [textureInput('in', 'Image 1'), textureInput('in-2', 'Image 2')],
        outputs: [textureOutput()],
      };
    case 'splitter':
      return {
        inputs: [textureInput()],
        outputs: [
          textureOutput('red-out', 'Red'),
          textureOutput('green-out', 'Green'),
          textureOutput('blue-out', 'Blue'),
        ],
      };
    case 'combiner':
      return {
        inputs: [
          textureInput('red-in', 'Red'),
          textureInput('green-in', 'Green'),
          textureInput('blue-in', 'Blue'),
        ],
        outputs: [textureOutput()],
      };
    default:
      return {
        inputs: [textureInput(), keyInput()],
        outputs: [textureOutput(), keyOutput()],
      };
  }
}

