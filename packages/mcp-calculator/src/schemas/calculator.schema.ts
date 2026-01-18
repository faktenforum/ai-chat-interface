import { z } from 'zod';

export const CalculatorInputSchema = z.object({
  operation: z.enum(['add', 'subtract', 'multiply', 'divide']).describe('The arithmetic operation to perform'),
  a: z.number().describe('First number'),
  b: z.number().describe('Second number'),
});

export type CalculatorInput = z.infer<typeof CalculatorInputSchema>;

export const BinaryOperationSchema = z.object({
  a: z.number().describe('First number'),
  b: z.number().describe('Second number'),
});

export type BinaryOperation = z.infer<typeof BinaryOperationSchema>;
