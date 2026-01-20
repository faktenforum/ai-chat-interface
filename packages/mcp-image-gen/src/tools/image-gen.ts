import type { TextContent, ImageContent } from '@modelcontextprotocol/sdk/types.js';
import { GenerateImageSchema, CheckModelSchema, type GenerateImageInput, type CheckModelInput } from '../schemas/image-gen.schema.ts';
import { OpenRouterClient, type OpenRouterModel } from '../services/openrouter.ts';
import { InvalidInputError, ImageGenError } from '../utils/errors.ts';
import { logger } from '../utils/logger.ts';

// Known models registry with their characteristics
export const KNOWN_MODELS = {
  'black-forest-labs/flux.2-pro': {
    id: 'black-forest-labs/flux.2-pro',
    name: 'FLUX.2 Pro',
    description: 'High-quality image generation with excellent detail',
    supportsAspectRatio: false,
    supportsImageSize: false,
    strengths: ['Highest quality', 'Excellent detail', 'Photorealistic', 'Professional results'],
    weaknesses: ['No aspect ratio control', 'No resolution options'],
    recommended_for: ['Product images', 'Portraits', 'Detailed art', 'Professional photography'],
  },
  'black-forest-labs/flux.2-flex': {
    id: 'black-forest-labs/flux.2-flex',
    name: 'FLUX.2 Flex',
    description: 'Flexible image generation model with good balance of quality and speed',
    supportsAspectRatio: false,
    supportsImageSize: false,
    strengths: ['Flexible styles', 'Good balance', 'Fast generation'],
    weaknesses: ['No aspect ratio control', 'No resolution options'],
    recommended_for: ['Varied styles', 'Creative work', 'Quick iterations'],
  },
  'google/gemini-2.5-flash-image-preview': {
    id: 'google/gemini-2.5-flash-image-preview',
    name: 'Gemini 2.5 Flash Image',
    description: 'Fast image generation with aspect ratio and resolution control',
    supportsAspectRatio: true,
    supportsImageSize: true,
    strengths: ['Fast generation', 'Aspect ratio control', 'Resolution options', 'Multiple sizes'],
    weaknesses: ['May have lower quality than FLUX.2 Pro for some use cases'],
    recommended_for: ['Social media', 'Quick iterations', 'Custom aspect ratios', 'Multiple resolutions'],
  },
  'sourceful/riverflow-v2-standard-preview': {
    id: 'sourceful/riverflow-v2-standard-preview',
    name: 'Riverflow v2',
    description: 'Standard preview model for image generation',
    supportsAspectRatio: false,
    supportsImageSize: false,
    strengths: ['Good quality', 'Reliable'],
    weaknesses: ['No aspect ratio control', 'No resolution options'],
    recommended_for: ['General purpose', 'Standard images'],
  },
} as const;

export type KnownModel = typeof KNOWN_MODELS[keyof typeof KNOWN_MODELS];

/**
 * Generate an image using OpenRouter API
 */
export async function generateImage(
  input: unknown,
  openRouterClient: OpenRouterClient,
): Promise<{ content: Array<TextContent | ImageContent> }> {
  try {
    const { prompt, model, aspect_ratio, image_size } = GenerateImageSchema.parse(input);

    logger.info({ model, hasAspectRatio: !!aspect_ratio, hasImageSize: !!image_size }, 'Generating image');

    const imageUrl = await openRouterClient.generateImage({
      prompt,
      model,
      aspect_ratio,
      image_size,
    });

    // Parse data URL to extract base64 data and mimeType
    // Format: "data:image/png;base64,iVBORw0KGgo..."
    // MCP Standard: { type: 'image', data: 'base64string', mimeType: 'image/png' }
    let base64Data: string;
    let mimeType: string = 'image/png'; // default

    try {
      if (imageUrl.startsWith('data:')) {
        // Parse data URL: data:image/png;base64,<base64data>
        const dataUrlMatch = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (dataUrlMatch && dataUrlMatch.length >= 3) {
          mimeType = dataUrlMatch[1] || 'image/png';
          base64Data = dataUrlMatch[2];
          logger.debug({ mimeType, dataLength: base64Data.length }, 'Parsed data URL');
        } else {
          // Fallback: try to extract base64 after "base64,"
          const base64Index = imageUrl.indexOf('base64,');
          if (base64Index !== -1) {
            base64Data = imageUrl.substring(base64Index + 7);
            // Try to extract mimeType from data: prefix
            const mimeMatch = imageUrl.match(/^data:([^;]+)/);
            if (mimeMatch && mimeMatch[1]) {
              mimeType = mimeMatch[1];
            }
            logger.debug({ mimeType, dataLength: base64Data.length }, 'Extracted base64 from data URL (fallback)');
          } else {
            throw new Error('Invalid data URL format: could not extract base64 data');
          }
        }
      } else if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
        // HTTP URL - pass through as-is (LibreChat formatter handles this)
        base64Data = imageUrl;
        mimeType = 'image/png'; // Default for URLs
        logger.debug({ url: imageUrl.substring(0, 50) + '...' }, 'Using HTTP URL');
      } else {
        // Assume it's already base64 without data: prefix
        base64Data = imageUrl;
        logger.debug({ dataLength: base64Data.length }, 'Using raw base64 data');
      }

      // Validate base64 data is not empty
      if (!base64Data || base64Data.length === 0) {
        throw new Error('Empty base64 data extracted from image URL');
      }

      // Return image content according to MCP specification
      // LibreChat's parser will convert this to image_url format for display
      const imageContent: ImageContent = {
        type: 'image',
        data: base64Data,
        mimeType: mimeType,
      };

      logger.debug({ mimeType, hasData: !!base64Data }, 'Returning image content');

      return {
        content: [
          {
            type: 'text',
            text: 'Image generated successfully.',
          },
          imageContent,
        ],
      };
    } catch (parseError) {
      logger.error(
        { 
          error: parseError instanceof Error ? parseError.message : String(parseError),
          imageUrlLength: imageUrl.length,
          imageUrlPrefix: imageUrl.substring(0, 50)
        },
        'Error parsing image data URL'
      );
      throw new ImageGenError(
        `Failed to parse image data: ${parseError instanceof Error ? parseError.message : String(parseError)}`
      );
    }
  } catch (error) {
    logger.error({ tool: 'generate_image', input, error: error instanceof Error ? error.message : String(error) }, 'Tool execution failed');
    
    if (error instanceof InvalidInputError) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error.message}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: error instanceof ImageGenError
            ? `Error: ${error.message}`
            : `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}

/**
 * List known models with their characteristics
 */
export function listKnownModels(): { content: TextContent[] } {
  const models = Object.values(KNOWN_MODELS);
  
  const formatted = models.map((model) => {
    return `**${model.name}** (${model.id})
- Description: ${model.description}
- Supports Aspect Ratio: ${model.supportsAspectRatio ? 'Yes' : 'No'}
- Supports Image Size: ${model.supportsImageSize ? 'Yes' : 'No'}
- Strengths: ${model.strengths.join(', ')}
- Weaknesses: ${model.weaknesses.join(', ')}
- Recommended for: ${model.recommended_for.join(', ')}`;
  }).join('\n\n');

  return {
    content: [
      {
        type: 'text',
        text: `# Known Image Generation Models\n\n${formatted}\n\nNote: You can also use any other OpenRouter-compatible image generation model. Use \`list_available_models\` to discover all available models, or \`check_model\` to verify if a specific model supports image generation.`,
      },
    ],
  };
}

/**
 * List all available image generation models from OpenRouter API
 */
export async function listAvailableModels(
  openRouterClient: OpenRouterClient,
): Promise<{ content: TextContent[] }> {
  try {
    const models = await openRouterClient.listImageModels();

    if (models.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No image generation models found. This may indicate an API error or connectivity issue.',
          },
        ],
      };
    }

    const formatted = models.map((model) => {
      const pricing = model.pricing
        ? `\n  - Pricing: Prompt: ${model.pricing.prompt || 'N/A'}, Completion: ${model.pricing.completion || 'N/A'}`
        : '';
      const contextLength = model.context_length ? `\n  - Context Length: ${model.context_length.toLocaleString()} tokens` : '';
      
      return `**${model.name || model.id}** (${model.id})${pricing}${contextLength}`;
    }).join('\n\n');

    return {
      content: [
        {
          type: 'text',
          text: `# Available Image Generation Models from OpenRouter\n\nFound ${models.length} model(s):\n\n${formatted}\n\nUse \`check_model\` to get detailed information about a specific model.`,
        },
      ],
    };
  } catch (error) {
    logger.error({ tool: 'list_available_models', error: error instanceof Error ? error.message : String(error) }, 'Tool execution failed');
    
    return {
      content: [
        {
          type: 'text',
          text: `Error fetching available models: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}

/**
 * Check if a specific model exists and supports image generation
 */
export async function checkModel(
  input: unknown,
  openRouterClient: OpenRouterClient,
): Promise<{ content: TextContent[] }> {
  try {
    const { model } = CheckModelSchema.parse(input);

    logger.info({ model }, 'Checking model');

    const result = await openRouterClient.checkModel(model);

    if (!result.exists) {
      return {
        content: [
          {
            type: 'text',
            text: `Model "${model}" was not found in OpenRouter's model list. Please verify the model ID is correct.`,
          },
        ],
      };
    }

    if (!result.supportsImageGeneration) {
      return {
        content: [
          {
            type: 'text',
            text: `Model "${model}" exists but does not support image generation. This model's output_modalities does not include "image".`,
          },
        ],
      };
    }

    const details = result.details!;
    const pricing = details.pricing
      ? `\n- Pricing: Prompt: ${details.pricing.prompt || 'N/A'}, Completion: ${details.pricing.completion || 'N/A'}`
      : '';
    const contextLength = details.context_length
      ? `\n- Context Length: ${details.context_length.toLocaleString()} tokens`
      : '';
    const description = details.description ? `\n- Description: ${details.description}` : '';

    // Check if it's a known model
    const knownModel = KNOWN_MODELS[model as keyof typeof KNOWN_MODELS];
    const knownInfo = knownModel
      ? `\n\n**Known Model Information:**\n- Supports Aspect Ratio: ${knownModel.supportsAspectRatio ? 'Yes' : 'No'}\n- Supports Image Size: ${knownModel.supportsImageSize ? 'Yes' : 'No'}\n- Strengths: ${knownModel.strengths.join(', ')}\n- Recommended for: ${knownModel.recommended_for.join(', ')}`
      : '';

    return {
      content: [
        {
          type: 'text',
          text: `Model "${model}" exists and supports image generation!${description}${pricing}${contextLength}${knownInfo}\n\nYou can use this model with the \`generate_image\` tool.`,
        },
      ],
    };
  } catch (error) {
    logger.error({ tool: 'check_model', input, error: error instanceof Error ? error.message : String(error) }, 'Tool execution failed');
    
    if (error instanceof InvalidInputError) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error.message}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: `Error checking model: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}
