const SYMBOLS: Record<string, string> = { add: '+', subtract: '−', multiply: '×', divide: '÷', power: '^', min: 'min', max: 'max', abs: '|x|', sin: 'sin', clamp: 'clamp', constant: '=' };
export function mathNodeSymbol(operator: string, operation?: string): string | undefined {
  return operator.startsWith('math.') ? SYMBOLS[operator.slice(5)] : operator === 'flock.math' ? SYMBOLS[operation ?? 'multiply'] : operator === 'flock.value' ? '=' : undefined;
}
