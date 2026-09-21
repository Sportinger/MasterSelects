import type { ImageOperatorCapability, ImagePlanInstruction } from './imageOperatorGraph';

interface ReducerScope { id: number; sample: number; weight: number }
export function emitImageReducerWgsl(input: { instructions: ImagePlanInstruction[]; expressions: string[];
  kernelScopes: ReducerScope[]; sequenceScopes: ReducerScope[]; scopeParameters: string[];
  capabilities: readonly ImageOperatorCapability[]; hasParameters: boolean }): string[] {
  const { instructions, expressions, kernelScopes, sequenceScopes, scopeParameters, capabilities, hasParameters } = input;
  const context = [...(capabilities.includes('resolution') ? ['inputResolution'] : []),
    ...(capabilities.includes('time') ? ['timelineTimeSeconds'] : []), ...(hasParameters ? ['imageParameters'] : [])];
  const typedContext = [...(capabilities.includes('resolution') ? ['inputResolution: vec2f'] : []),
    ...(capabilities.includes('time') ? ['timelineTimeSeconds: f32'] : []), ...(hasParameters ? ['imageParameters: ImageOperatorParameters'] : [])];
  const body = (scope: ReducerScope) => expressions.filter((_line, index) => instructions[index].scope === scope.id).join('\n');
  const output: string[] = [];
  if (kernelScopes.length) output.push('struct ImageKernelTerm { sample: vec4f, weight: f32 }', 'struct ImageKernelResult { sum: vec4f, weightSum: f32 }');
  for (const scope of kernelScopes.toSorted((a, b) => b.id - a.id)) output.push(
    `fn evaluateKernelTerm${scope.id}(${[...scopeParameters, 'kernelIndex: vec2f'].join(', ')}) -> ImageKernelTerm {\n  let pixel = inputColor;\n${body(scope)}\n  return ImageKernelTerm(v${scope.sample}, v${scope.weight});\n}`,
    `fn imageKernelReduce${scope.id}(${['extentValue: f32', 'centerPixel: vec4f', 'inputUv: vec2f', ...typedContext].join(', ')}) -> ImageKernelResult {\n  let extent = i32(clamp(trunc(extentValue), 0.0, 64.0));\n  var sum = vec4f(0.0); var weightSum = 0.0;\n  for (var x = -extent; x <= extent; x++) { for (var y = -extent; y <= extent; y++) {\n    let term = evaluateKernelTerm${scope.id}(${['centerPixel', 'inputUv', ...context, 'vec2f(f32(x), f32(y))'].join(', ')}); sum += term.sample * term.weight; weightSum += term.weight;\n  }}\n  return ImageKernelResult(sum, weightSum);\n}`);
  if (sequenceScopes.length) output.push('struct ImageSequenceTerm { sample: vec4f, weight: f32 }', 'struct ImageSequenceResult { sum: vec4f, weightSum: f32 }');
  for (const scope of sequenceScopes.toSorted((a, b) => b.id - a.id)) output.push(
    `fn evaluateSequenceTerm${scope.id}(${[...scopeParameters, 'sequenceIndex: f32', 'sequenceT: f32'].join(', ')}) -> ImageSequenceTerm {\n  let pixel = inputColor;\n${body(scope)}\n  return ImageSequenceTerm(v${scope.sample}, v${scope.weight});\n}`,
    `fn imageSequenceReduce${scope.id}(${['countValue: f32', 'centerPixel: vec4f', 'inputUv: vec2f', ...typedContext].join(', ')}) -> ImageSequenceResult {\n  let count = i32(clamp(trunc(countValue), 1.0, 256.0));\n  var sum = vec4f(0.0); var weightSum = 0.0;\n  for (var i = 0; i < count; i++) { var t = 0.0; if (count > 1) { t = f32(i) / f32(count - 1); }\n    let term = evaluateSequenceTerm${scope.id}(${['centerPixel', 'inputUv', ...context, 'f32(i)', 't'].join(', ')}); sum += term.sample * term.weight; weightSum += term.weight;\n  }\n  return ImageSequenceResult(sum, weightSum);\n}`);
  return output;
}
