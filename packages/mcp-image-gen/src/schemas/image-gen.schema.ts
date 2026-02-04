import { z } from 'zod';
import { EXAMPLE_MODEL_ID } from '../constants/models.ts';

// Supported aspect ratios (see KNOWN_MODELS.supportsAspectRatio)
export const ASPECT_RATIOS = [
  '1:1',   // 1024×1024 (default)
  '2:3',   // 832×1248
  '3:2',   // 1248×832
  '3:4',   // 864×1184
  '4:3',   // 1184×864
  '4:5',   // 896×1152
  '5:4',   // 1152×896
  '9:16',  // 768×1344
  '16:9',  // 1344×768
  '21:9',  // 1536×672
] as const;

// Supported image sizes (see KNOWN_MODELS.supportsImageSize)
export const IMAGE_SIZES = ['1K', '2K', '4K'] as const;

// Generate image input schema
export const GenerateImageSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .describe('Detailed text description of the image to generate. Should be 3-6 sentences, focusing on visual elements, lighting, composition, mood, and style.'),
  model: z
    .string()
    .min(1)
    .describe('The image generation model to use. Any OpenRouter-compatible image generation model can be used. Required parameter.'),
  aspect_ratio: z
    .enum(ASPECT_RATIOS)
    .optional()
    .describe('Aspect ratio for the generated image. Only supported by models that declare it (see list_models). Defaults to 1:1 (square).'),
  image_size: z
    .enum(IMAGE_SIZES)
    .optional()
    .describe('Image size/resolution. Only supported by models that declare it (see list_models). Defaults to 1K.'),
});

export type GenerateImageInput = z.infer<typeof GenerateImageSchema>;

// Check model input schema
export const CheckModelSchema = z.object({
  model: z
    .string()
    .min(1)
    .describe(`The model identifier to check (e.g., "${EXAMPLE_MODEL_ID}")`),
});

export type CheckModelInput = z.infer<typeof CheckModelSchema>;
