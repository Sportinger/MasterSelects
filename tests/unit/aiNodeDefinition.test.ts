import { describe, expect, it } from 'vitest';
import {
  extractAINodeGeneratedCode,
  extractAINodeParameterSchemaFromCode,
  mergeAINodeParamDefaults,
} from '../../src/services/nodeGraph';

describe('AI node definition helpers', () => {
  it('extracts exposed parameter schema from generated defineNode code', () => {
    const schema = extractAINodeParameterSchemaFromCode(`
      defineNode({
        name: 'Threshold',
        params: [
          { id: 'amount', label: 'Amount', type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
          { id: 'enabled', label: 'Enabled', type: 'boolean', default: true },
          { id: 'tintColor', label: 'Tint Color', type: 'color', default: '#008CFF' }
        ],
        process(input, context) { return { output: input.input }; }
      })
    `);

    expect(schema).toEqual([
      { id: 'amount', label: 'Amount', type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
      { id: 'enabled', label: 'Enabled', type: 'boolean', default: true },
      { id: 'tintColor', label: 'Tint Color', type: 'color', default: '#008cff' },
    ]);
  });

  it('normalizes generated color params from rgb arrays', () => {
    const schema = extractAINodeParameterSchemaFromCode(`
      defineNode({
        name: 'Color',
        params: [
          { id: 'tintColor', label: 'Tint Color', type: 'color', default: [0, 0.5, 1, 1] }
        ],
        process(input) { return { output: input.input }; }
      })
    `);

    expect(schema).toEqual([
      { id: 'tintColor', label: 'Tint Color', type: 'color', default: '#0080ff' },
    ]);
  });

  it('merges existing parameter values over defaults', () => {
    const params = mergeAINodeParamDefaults(
      [
        { id: 'amount', label: 'Amount', type: 'number', default: 0.5 },
        { id: 'mode', label: 'Mode', type: 'string', default: 'soft' },
      ],
      { amount: 0.8 },
    );

    expect(params).toEqual({ amount: 0.8, mode: 'soft' });
  });

  it('extracts active code from the AI activate_code tool block', () => {
    const code = `
      defineNode({
        name: 'PassThrough',
        process(input) { return { output: input.input }; }
      })
    `.trim();

    expect(extractAINodeGeneratedCode(`Looks good.\n<activate_code>\n${code}\n</activate_code>`)).toBe(code);
  });

  it('does not treat normal chat text as generated code', () => {
    expect(extractAINodeGeneratedCode('Wir koennen das planen, bevor wir Code aktivieren.')).toBeNull();
    expect(extractAINodeGeneratedCode('Use defineNode(...) later when you are ready.')).toBeNull();
  });

  it('still accepts raw defineNode code for manual code editing', () => {
    const code = 'defineNode({ process(input) { return { output: input.input }; } })';
    expect(extractAINodeGeneratedCode(code)).toBe(code);
  });
});
