import type { TextContent, ImageContent } from '@modelcontextprotocol/sdk/types.js';
import { GenerateImageSchema, CheckModelSchema } from '../schemas/image-gen.schema.ts';
import { OpenRouterClient } from '../services/openrouter.ts';
import { InvalidInputError, ImageGenError } from '../utils/errors.ts';
import { logger } from '../utils/logger.ts';
import { parseImageData } from '../utils/data-url.ts';
import { KNOWN_MODELS } from '../constants/models.ts';
import { formatKnownModel, formatApiModel, formatModelDetails } from '../utils/model-formatting.ts';

export type { KnownModel } from '../constants/models.ts';

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

    try {
      const { data, mimeType } = parseImageData(imageUrl);
      
      if (!data || data.length === 0) {
        throw new Error('Empty base64 data extracted from image URL');
      }

      const imageContent: ImageContent = {
        type: 'image',
        data,
        mimeType,
      };

      logger.debug({ mimeType, hasData: !!data }, 'Returning image content');

      return {
        content: [
          { type: 'text', text: 'Image generated successfully.' },
          imageContent,
        ],
      };
    } catch (parseError) {
      logger.error(
        {
          error: parseError instanceof Error ? parseError.message : String(parseError),
          imageUrlLength: imageUrl.length,
          imageUrlPrefix: imageUrl.substring(0, 50),
        },
        'Error parsing image data URL',
      );
      throw new ImageGenError(
        `Failed to parse image data: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
        'IMAGE_DATA_PARSE_ERROR',
      );
    }
  } catch (error) {
    if (error instanceof InvalidInputError) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
      };
    }
    throw error;
  }
}

export function listKnownModels(): { content: TextContent[] } {
  const formatted = Object.values(KNOWN_MODELS)
    .map(formatKnownModel)
    .join('\n\n');

  return {
    content: [
      {
        type: 'text',
        text: `# Known Image Generation Models\n\n${formatted}\n\nNote: You can also use any other OpenRouter-compatible image generation model. Use \`list_available_models\` to discover all available models, or \`check_model\` to verify if a specific model supports image generation.`,
      },
    ],
  };
}

export async function listAvailableModels(
  openRouterClient: OpenRouterClient,
): Promise<{ content: TextContent[] }> {
  try {
    const apiModels = await openRouterClient.listImageModels();
    const modelMap = new Map<string, { id: string; name: string; pricing?: { prompt?: string; completion?: string }; context_length?: number; description?: string }>();

    // Add known models first
    Object.values(KNOWN_MODELS).forEach((model) => {
      modelMap.set(model.id, {
        id: model.id,
        name: model.name,
        pricing: model.pricing,
        description: model.description,
      });
    });

    // Merge API models
    apiModels.forEach((model) => {
      const existing = modelMap.get(model.id);
      modelMap.set(model.id, {
        id: model.id,
        name: model.name || existing?.name || model.id,
        pricing: model.pricing || existing?.pricing,
        context_length: model.context_length,
        description: model.description || existing?.description,
      });
    });

    const combinedModels = Array.from(modelMap.values());

    if (combinedModels.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No image generation models found. This may indicate an API error or connectivity issue.',
          },
        ],
      };
    }

    const formatted = combinedModels.map(formatApiModel).join('\n\n');

    return {
      content: [
        {
          type: 'text',
          text: `# Available Image Generation Models from OpenRouter\n\nFound ${combinedModels.length} model(s):\n\n${formatted}\n\nUse \`check_model\` to get detailed information about a specific model.`,
        },
      ],
    };
  } catch (error) {
    logger.error(
      { tool: 'list_available_models', error: error instanceof Error ? error.message : String(error) },
      'Tool execution failed',
    );
    throw error;
  }
}

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

    const knownModel = KNOWN_MODELS[model as keyof typeof KNOWN_MODELS];
    const details = formatModelDetails(result.details!, knownModel);

    return {
      content: [
        {
          type: 'text',
          text: `Model "${model}" exists and supports image generation!${details}\n\nYou can use this model with the \`generate_image\` tool.`,
        },
      ],
    };
  } catch (error) {
    if (error instanceof InvalidInputError) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
      };
    }
    throw error;
  }
}
