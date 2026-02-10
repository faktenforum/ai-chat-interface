/**
 * Zod schemas for terminal tools
 */

import { z } from 'zod';

export const ExecuteCommandSchema = z.object({
  command: z.string().min(1).describe('Shell command to execute'),
  timeout_ms: z.number().positive().default(30000).describe('Command timeout in milliseconds (default: 30000)'),
  workspace: z.string().default('default').describe('Workspace context for the command (default: "default")'),
  terminal_id: z.string().optional().describe('Reuse an existing terminal session (optional)'),
});

export const ReadTerminalOutputSchema = z.object({
  terminal_id: z.string().describe('Terminal session ID'),
  offset: z.number().min(0).default(0).describe('Start reading from this character offset'),
  length: z.number().positive().optional().describe('Maximum characters to read (reads all remaining if omitted)'),
});

export const WriteTerminalSchema = z.object({
  terminal_id: z.string().describe('Terminal session ID'),
  input: z.string().describe('Input to send to the terminal (e.g., for interactive prompts, REPLs)'),
  timeout_ms: z.number().positive().default(5000).describe('Wait timeout for response in milliseconds (default: 5000)'),
});

export const ListTerminalsSchema = z.object({});

export const KillTerminalSchema = z.object({
  terminal_id: z.string().describe('Terminal session ID to terminate'),
});
