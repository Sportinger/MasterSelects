import type { AudioRoute } from './routeGraphTypes';
import { reconnectCustomProcessorInternal } from './processorGraphReconnect';

export function reconnectAudioRoute(route: AudioRoute, masterInput: AudioNode): void {
  try {
    route.sourceNode.disconnect();
    route.cutGainNode.disconnect();
    route.gainNode.disconnect();
    route.eqFilters.forEach(filter => filter.disconnect());
    route.panNode.disconnect();
    route.analyserNode.disconnect();
    route.stereoSplitterNode.disconnect();
    route.leftAnalyserNode.disconnect();
    route.rightAnalyserNode.disconnect();
    route.processorNodes.forEach(processor => processor.nodes.forEach(node => node.disconnect()));
  } catch {
    // Disconnecting a partially connected graph can throw; rebuild below.
  }

  let tail: AudioNode = route.gainNode;
  route.sourceNode.connect(route.cutGainNode);
  route.cutGainNode.connect(route.gainNode);

  for (const processor of route.processorNodes) {
    if (processor.inputNode && processor.outputNode) {
      reconnectCustomProcessorInternal(processor);
      tail.connect(processor.inputNode);
      tail = processor.outputNode;
    } else {
      for (const node of processor.nodes) {
        tail.connect(node);
        tail = node;
      }
    }
  }

  tail.connect(route.eqFilters[0]);
  for (let i = 0; i < route.eqFilters.length - 1; i++) {
    route.eqFilters[i].connect(route.eqFilters[i + 1]);
  }
  route.eqFilters[route.eqFilters.length - 1].connect(route.panNode);
  route.panNode.connect(route.stereoSplitterNode);
  route.stereoSplitterNode.connect(route.leftAnalyserNode, 0);
  route.stereoSplitterNode.connect(route.rightAnalyserNode, 1);
  route.panNode.connect(route.analyserNode);
  route.analyserNode.connect(masterInput);
  route.isConnected = true;
}

