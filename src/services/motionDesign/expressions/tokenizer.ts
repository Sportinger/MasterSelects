import {
  MOTION_EXPRESSION_BUDGETS,
  MOTION_EXPRESSION_ERROR_CODES,
  type MotionExpressionFailure,
  type MotionExpressionResult,
  type MotionExpressionToken,
  type MotionExpressionTokenType,
} from './contracts';

const SINGLE_CHARACTER_TOKENS: Readonly<Record<string, MotionExpressionTokenType>> = {
  '+': 'plus',
  '-': 'minus',
  '*': 'star',
  '/': 'slash',
  '%': 'percent',
  '(': 'left-paren',
  ')': 'right-paren',
  ',': 'comma',
};

function failure(
  code: MotionExpressionFailure['code'],
  position: number,
  message: string,
): MotionExpressionFailure {
  return { code, position, message };
}

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= '0' && character <= '9';
}

function isIdentifierStart(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z_]/.test(character);
}

function isIdentifierPart(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_]/.test(character);
}

export function tokenizeMotionExpression(source: string): MotionExpressionResult<readonly MotionExpressionToken[]> {
  if (typeof source !== 'string') {
    return {
      ok: false,
      failures: [failure(
        MOTION_EXPRESSION_ERROR_CODES.SOURCE_INVALID,
        0,
        'Expression source must be a string.',
      )],
    };
  }
  if (source.length === 0 || source.length > MOTION_EXPRESSION_BUDGETS.maxSourceLength) {
    return {
      ok: false,
      failures: [failure(
        source.length === 0
          ? MOTION_EXPRESSION_ERROR_CODES.SOURCE_INVALID
          : MOTION_EXPRESSION_ERROR_CODES.SOURCE_BUDGET_EXCEEDED,
        0,
        'Expression source must be non-empty and within the source budget.',
      )],
    };
  }

  const tokens: MotionExpressionToken[] = [];
  let cursor = 0;
  const push = (token: MotionExpressionToken): MotionExpressionFailure | undefined => {
    if (tokens.length >= MOTION_EXPRESSION_BUDGETS.maxTokens) {
      return failure(
        MOTION_EXPRESSION_ERROR_CODES.TOKEN_BUDGET_EXCEEDED,
        token.position,
        'Expression exceeds the token budget.',
      );
    }
    tokens.push(token);
    return undefined;
  };

  while (cursor < source.length) {
    const character = source[cursor];
    if (/\s/.test(character)) {
      cursor += 1;
      continue;
    }
    const singleType = SINGLE_CHARACTER_TOKENS[character];
    if (singleType) {
      const budgetFailure = push({ type: singleType, lexeme: character, position: cursor });
      if (budgetFailure) return { ok: false, failures: [budgetFailure] };
      cursor += 1;
      continue;
    }
    if (isDigit(character) || (character === '.' && isDigit(source[cursor + 1]))) {
      const start = cursor;
      while (isDigit(source[cursor])) cursor += 1;
      if (source[cursor] === '.') {
        cursor += 1;
        while (isDigit(source[cursor])) cursor += 1;
      }
      if (source[cursor] === 'e' || source[cursor] === 'E') {
        cursor += 1;
        if (source[cursor] === '+' || source[cursor] === '-') cursor += 1;
        const exponentStart = cursor;
        while (isDigit(source[cursor])) cursor += 1;
        if (cursor === exponentStart) {
          return {
            ok: false,
            failures: [failure(
              MOTION_EXPRESSION_ERROR_CODES.TOKEN_INVALID,
              start,
              'Numeric exponent requires at least one digit.',
            )],
          };
        }
      }
      const lexeme = source.slice(start, cursor);
      const numericValue = Number(lexeme);
      if (!Number.isFinite(numericValue)) {
        return {
          ok: false,
          failures: [failure(
            MOTION_EXPRESSION_ERROR_CODES.TOKEN_INVALID,
            start,
            'Numeric literals must be finite.',
          )],
        };
      }
      const budgetFailure = push({ type: 'number', lexeme, position: start, numericValue });
      if (budgetFailure) return { ok: false, failures: [budgetFailure] };
      continue;
    }
    if (isIdentifierStart(character)) {
      const start = cursor;
      cursor += 1;
      while (isIdentifierPart(source[cursor])) cursor += 1;
      const lexeme = source.slice(start, cursor);
      const budgetFailure = push({ type: 'identifier', lexeme, position: start });
      if (budgetFailure) return { ok: false, failures: [budgetFailure] };
      continue;
    }
    return {
      ok: false,
      failures: [failure(
        MOTION_EXPRESSION_ERROR_CODES.TOKEN_INVALID,
        cursor,
        `Character ${JSON.stringify(character)} is not part of the Motion expression grammar.`,
      )],
    };
  }

  tokens.push({ type: 'eof', lexeme: '', position: source.length });
  return { ok: true, value: tokens };
}
