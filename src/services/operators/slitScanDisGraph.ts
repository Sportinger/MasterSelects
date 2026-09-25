import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

/** Replace only the generated time-gradient detector. Keep authored scan UVs,
 * delay expressions, smoothing and preview wiring, including custom consumers. */
export function withSlitScanDisMask(graph: EffectOperatorGraph): EffectOperatorGraph {
  if (graph.nodes.some(node => node.id === 'motion-scan-dis-source')) return graph;
  const affected = graph.edges.find(edge => edge.to === 'motion-scan-affected' && edge.input === 'value'
    && edge.from === 'motion-scan-time-change');
  const reliable = graph.edges.find(edge => edge.to === 'motion-scan-reliable-area' && edge.input === 'b'
    && edge.from === 'motion-scan-one');
  const delay = graph.edges.find(edge => edge.to === 'motion-scan-gradient' && edge.input === 'value');
  if (!delay) return graph;
  const history = graph.nodes.find(node => node.operator === 'image.sample-history'
    && graph.edges.some(edge => edge.to === node.id && edge.input === 'delay' && edge.from === delay.from && edge.output === delay.output));
  const uv = graph.edges.find(edge => edge.to === history?.id && edge.input === 'uv');
  if (!affected || !reliable || !delay || !uv) return graph;
  type Ref = [string,string];
  const nodes: BoundOperatorNode[] = [], edges: OperatorEdge[] = [];
  const add = (name: string, operator: string, inputs: Record<string,Ref> = {}, output = 'value',
    constants?: BoundOperatorNode['constants'], bindings: Record<string,string> = {}): Ref => {
    const id = `motion-scan-dis-${name}`;
    nodes.push({ id,operator,operatorVersion: 1,bindings,...(constants ? { constants } : {}) });
    for (const [input,[from,port]] of Object.entries(inputs)) edges.push({ id: `${id}:${input}`,from,output: port,to: id,input });
    return [id,output];
  };
  const number = (name: string,value: number) => add(name,'values.number',{},'value',{ value });
  const motion = add('source','image.source-motion', { uv: [uv.from,uv.output],delay: [delay.from,delay.output],
    interval: number('interval',1/30) },'image',{ denseInverseSearch: true,stabilize: true },{ lookback: 'delay',timeFactor: 'timeFactor' });
  const deformation = add('deformation','motion.temporal-deformation',{ motion,gradient: ['motion-scan-gradient','gradient'],
    resolution: ['motion-scan-resolution','value'] });
  const components = add('components','vector.split.vec4',{ value: deformation },'x');
  const confidence = add('confidence','math.smoothstep.scalar',{ value: [components[0],'z'],
    edge0: number('confidence-low',.15),edge1: number('confidence-high',.6) });
  let result: EffectOperatorGraph = { ...graph,
    nodes: [...graph.nodes.map(node => node.id === 'motion-scan-threshold-control'
      ? { ...node,bindings: { ...node.bindings,value: 'scanStretchThreshold' } }
      : node.id === 'motion-scan-threshold-feather' ? { ...node,constants: { ...node.constants,value: .25 } } : node),...nodes],
    edges: [...graph.edges.map(edge => edge === affected ? { ...edge,from: components[0],output: 'x' }
      : edge === reliable ? { ...edge,from: confidence[0],output: confidence[1] } : edge),...edges],
    groups: graph.groups?.map(group => group.id === 'scan-motion'
      ? { ...group,label: 'DIS Stretch Smoothing',nodeIds: [...group.nodeIds,...nodes.map(node => node.id)] } : group),
    layout: { ...graph.layout,...Object.fromEntries(nodes.map((node,i) => [node.id,{ x: 10000+i%5*280,y: 2000+Math.floor(i/5)*180 }])) } };
  const obsolete = new Set(['time-change','time-units','time-gradient-source','time-gradient-length','time-gradient-uv',
    'safe-factor','factor'].map(id => `motion-scan-${id}`));
  while (true) {
    const unused = new Set(result.nodes.filter(node => obsolete.has(node.id) && !result.edges.some(edge => edge.from === node.id)).map(node => node.id));
    if (!unused.size) break;
    result = { ...result,nodes: result.nodes.filter(node => !unused.has(node.id)),edges: result.edges.filter(edge => !unused.has(edge.to)),
      groups: result.groups?.map(group => ({ ...group,nodeIds: group.nodeIds.filter(id => !unused.has(id)) })),
      layout: Object.fromEntries(Object.entries(result.layout ?? {}).filter(([id]) => !unused.has(id))) };
  }
  return result;
}

/** Offer the generated DIS field to the base sampler through a Flow strength
 * scale (RG only; confidence/validity pass through). The inspector switch selects
 * the sampler's motion input; while off, compile shortcuts drop that edge. */
export function withSlitScanMotionCompensation(graph: EffectOperatorGraph): EffectOperatorGraph {
  const dis = graph.nodes.find(node => node.id === 'motion-scan-dis-source' && node.operator === 'image.source-motion');
  const delay = graph.edges.find(edge => edge.to === dis?.id && edge.input === 'delay');
  const history = graph.nodes.find(node => node.operator === 'image.sample-history'
    && graph.edges.some(edge => edge.to === node.id && edge.input === 'delay' && edge.from === delay?.from && edge.output === delay?.output));
  if (!dis || !history || graph.nodes.some(node => node.id === 'motion-comp-scaled')) return graph;
  const existing = graph.edges.find(edge => edge.to === history.id && edge.input === 'motion');
  // Only the generated direct wiring is upgraded; authored motion sources stay.
  if (existing && existing.from !== dis.id) return graph;
  if (!existing && history.bindings.motionCompensation !== undefined) return graph;
  const nodes: BoundOperatorNode[] = [], edges: OperatorEdge[] = [];
  const add = (name: string, operator: string, inputs: Record<string, [string, string]> = {}, output = 'value',
    constants?: BoundOperatorNode['constants'], bindings: Record<string, string> = {}): [string, string] => {
    const id = `motion-comp-${name}`;
    nodes.push({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
    for (const [input, [from, port]] of Object.entries(inputs)) edges.push({ id: `${id}:${input}`, from, output: port, to: id, input });
    return [id, output];
  };
  const strength = add('strength', 'values.number', {}, 'value', undefined, { value: 'temporalMotionStrength' });
  const one = add('one', 'values.number', {}, 'value', { value: 1 });
  const scale = add('scale', 'vector.combine.vec4', { x: strength, y: strength, z: one, w: one });
  const field = add('field', 'convert.image-to-vec4', { image: [dis.id, 'image'] });
  const scaled = add('scaled', 'math.multiply.vec4', { a: field, b: scale });
  const image = add('image', 'convert.vec4-to-image', { value: scaled }, 'image');
  return { ...graph,
    nodes: [...graph.nodes.map(node => node === history ? { ...node, bindings: { ...node.bindings, motionCompensation: 'temporalMotion' } } : node), ...nodes],
    edges: [...graph.edges.filter(edge => edge !== existing), ...edges,
      { id: `${history.id}:motion`, from: image[0], output: image[1], to: history.id, input: 'motion' }],
    groups: graph.groups?.map(group => group.id === 'scan-motion' ? { ...group, nodeIds: [...group.nodeIds, ...nodes.map(node => node.id)] } : group),
    layout: { ...graph.layout, ...Object.fromEntries(nodes.map((node, i) => [node.id, { x: 10000 + i * 280, y: 2600 }])) } };
}
