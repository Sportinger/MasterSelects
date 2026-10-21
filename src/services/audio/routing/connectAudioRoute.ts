import type { AudioRoute, MasterAudioRoute } from './routeGraphTypes';
import { publishMasterTerminal } from './masterTap';
import { reconnectCustomProcessorInternal } from './processorGraphReconnect';

/** Disconnects every node of an element's route; the route stays reusable (reconnectAudioRoute). */
export function disconnectAudioRoute(route: AudioRoute): void {
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
    // Disconnecting a partially connected graph can throw.
  }
  route.isConnected = false;
}

export function reconnectAudioRoute(route: AudioRoute, masterInput: AudioNode): void {
  disconnectAudioRoute(route);

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


export function disconnectMasterAudioRoute(route: MasterAudioRoute): void {
  try {
    route.inputNode.disconnect();
    route.gainNode.disconnect();
    route.eqFilters.forEach(filter => filter.disconnect());
    route.analyserNode.disconnect();
    route.stereoSplitterNode.disconnect();
    route.leftAnalyserNode.disconnect();
    route.rightAnalyserNode.disconnect();
    route.processorNodes.forEach(processor => processor.nodes.forEach(node => node.disconnect()));
  } catch {
    // Disconnecting a partially connected graph can throw.
  }
}

/** Wires the shared master bus: input -> FX -> EQ -> gain -> meters -> destination. */
export function reconnectMasterAudioRoute(route: MasterAudioRoute, context: AudioContext): void {
  disconnectMasterAudioRoute(route);

  let tail: AudioNode = route.inputNode;

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
  for (let index = 0; index < route.eqFilters.length - 1; index += 1) {
    route.eqFilters[index].connect(route.eqFilters[index + 1]);
  }
  route.eqFilters[route.eqFilters.length - 1].connect(route.gainNode);
  route.gainNode.connect(route.stereoSplitterNode);
  route.stereoSplitterNode.connect(route.leftAnalyserNode, 0);
  route.stereoSplitterNode.connect(route.rightAnalyserNode, 1);
  route.gainNode.connect(route.analyserNode);
  route.analyserNode.connect(context.destination);
  publishMasterTerminal(context, route.analyserNode);
}
