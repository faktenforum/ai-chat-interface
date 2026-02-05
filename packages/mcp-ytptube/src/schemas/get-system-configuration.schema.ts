import { z } from 'zod';

export const GetSystemConfigurationSchema = z.object({});

export type GetSystemConfigurationInput = z.infer<typeof GetSystemConfigurationSchema>;
