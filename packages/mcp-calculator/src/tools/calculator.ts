import type { TextContent } from '@modelcontextprotocol/sdk/types.js';
import type { BinaryOperation } from '../schemas/calculator.schema.ts';
import { DivisionByZeroError } from '../utils/errors.ts';
import { logger } from '../utils/logger.ts';

interface CalculationHistory {
  operation: string;
  a: number;
  b: number;
  result: number;
  timestamp: Date;
}

const history: CalculationHistory[] = [];
const MAX_HISTORY_SIZE = 100;

export function add({ a, b }: BinaryOperation): { content: TextContent[] } {
  const result = a + b;

  addToHistory('add', a, b, result);

  return {
    content: [
      {
        type: 'text',
        text: `${a} + ${b} = ${result}`,
      },
    ],
  };
}

export function subtract({ a, b }: BinaryOperation): { content: TextContent[] } {
  const result = a - b;

  addToHistory('subtract', a, b, result);

  return {
    content: [
      {
        type: 'text',
        text: `${a} - ${b} = ${result}`,
      },
    ],
  };
}

export function multiply({ a, b }: BinaryOperation): { content: TextContent[] } {
  const result = a * b;

  addToHistory('multiply', a, b, result);

  return {
    content: [
      {
        type: 'text',
        text: `${a} × ${b} = ${result}`,
      },
    ],
  };
}

export function divide({ a, b }: BinaryOperation): { content: TextContent[] } | { content: TextContent[]; isError: boolean } {
  if (b === 0) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${new DivisionByZeroError().message}`,
        },
      ],
      isError: true,
    };
  }

  const result = a / b;
  addToHistory('divide', a, b, result);

  return {
    content: [
      {
        type: 'text',
        text: `${a} ÷ ${b} = ${result}`,
      },
    ],
  };
}

export function getHistory(): CalculationHistory[] {
  return [...history].reverse();
}

export function clearHistory(): void {
  history.length = 0;
}

function addToHistory(
  operation: string,
  a: number,
  b: number,
  result: number,
): void {
  history.push({
    operation,
    a,
    b,
    result,
    timestamp: new Date(),
  });
  
  // Keep history size limited
  if (history.length > MAX_HISTORY_SIZE) {
    history.shift();
  }
}
