import { z } from 'zod';

/**
 * Schema for calculator operation input
 */
export const CalculatorInputSchema = z.object({
  operation: z.enum(['add', 'subtract', 'multiply', 'divide'], {
    description: 'The arithmetic operation to perform',
  }),
  a: z.number({
    description: 'First number',
  }),
  b: z.number({
    description: 'Second number',
  }),
});

export type CalculatorInput = z.infer<typeof CalculatorInputSchema>;

/**
 * Schema for individual operation tools
 */
export const BinaryOperationSchema = z.object({
  a: z.number({
    description: 'First number',
  }),
  b: z.number({
    description: 'Second number',
  }),
});

export type BinaryOperation = z.infer<typeof BinaryOperationSchema>;
