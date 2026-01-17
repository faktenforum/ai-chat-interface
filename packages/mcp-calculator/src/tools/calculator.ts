import type { TextContent } from '@modelcontextprotocol/sdk/types.js';
import { BinaryOperationSchema, type BinaryOperation } from '../schemas/calculator.schema.js';
import { DivisionByZeroError, InvalidInputError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

interface CalculationHistory {
  operation: string;
  a: number;
  b: number;
  result: number;
  timestamp: Date;
}

const history: CalculationHistory[] = [];
const MAX_HISTORY_SIZE = 100;

export function add(input: unknown): { content: TextContent[] } {
  try {
    const { a, b } = BinaryOperationSchema.parse(input);
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
  } catch (error) {
    throw new InvalidInputError(`Invalid input for addition: ${String(error)}`);
  }
}

export function subtract(input: unknown): { content: TextContent[] } {
  try {
    const { a, b } = BinaryOperationSchema.parse(input);
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
  } catch (error) {
    throw new InvalidInputError(`Invalid input for subtraction: ${String(error)}`);
  }
}

export function multiply(input: unknown): { content: TextContent[] } {
  try {
    const { a, b } = BinaryOperationSchema.parse(input);
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
  } catch (error) {
    throw new InvalidInputError(`Invalid input for multiplication: ${String(error)}`);
  }
}

export function divide(input: unknown): { content: TextContent[]; isError?: boolean } {
  try {
    const { a, b } = BinaryOperationSchema.parse(input);
    
    if (b === 0) {
      throw new DivisionByZeroError();
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
  } catch (error) {
    if (error instanceof DivisionByZeroError) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
    throw new InvalidInputError(`Invalid input for division: ${String(error)}`);
  }
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
