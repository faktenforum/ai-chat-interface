import type { TextContent } from '@modelcontextprotocol/sdk/types.js';
import { BinaryOperationSchema, type BinaryOperation } from '../schemas/calculator.schema.js';
import { DivisionByZeroError, InvalidInputError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Calculation history (in-memory for this example)
 * In production, consider using a database or cache
 */
interface CalculationHistory {
  operation: string;
  a: number;
  b: number;
  result: number;
  timestamp: Date;
}

const history: CalculationHistory[] = [];
const MAX_HISTORY_SIZE = 100;

/**
 * Add two numbers
 */
export function add(input: unknown): { content: TextContent[] } {
  try {
    const { a, b } = BinaryOperationSchema.parse(input);
    const result = a + b;
    
    addToHistory('add', a, b, result);
    logger.info({ operation: 'add', a, b, result }, 'Addition performed');
    
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

/**
 * Subtract two numbers
 */
export function subtract(input: unknown): { content: TextContent[] } {
  try {
    const { a, b } = BinaryOperationSchema.parse(input);
    const result = a - b;
    
    addToHistory('subtract', a, b, result);
    logger.info({ operation: 'subtract', a, b, result }, 'Subtraction performed');
    
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

/**
 * Multiply two numbers
 */
export function multiply(input: unknown): { content: TextContent[] } {
  try {
    const { a, b } = BinaryOperationSchema.parse(input);
    const result = a * b;
    
    addToHistory('multiply', a, b, result);
    logger.info({ operation: 'multiply', a, b, result }, 'Multiplication performed');
    
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

/**
 * Divide two numbers
 */
export function divide(input: unknown): { content: TextContent[]; isError?: boolean } {
  try {
    const { a, b } = BinaryOperationSchema.parse(input);
    
    if (b === 0) {
      logger.warn({ operation: 'divide', a, b }, 'Division by zero attempted');
      throw new DivisionByZeroError();
    }
    
    const result = a / b;
    
    addToHistory('divide', a, b, result);
    logger.info({ operation: 'divide', a, b, result }, 'Division performed');
    
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

/**
 * Get calculation history
 */
export function getHistory(): CalculationHistory[] {
  return [...history].reverse(); // Return most recent first
}

/**
 * Clear calculation history
 */
export function clearHistory(): void {
  history.length = 0;
  logger.info('Calculation history cleared');
}

/**
 * Add calculation to history
 */
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
