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

/**
 * Lists all available image generation models, combining static metadata from known models
 * with dynamic metadata from the OpenRouter API.
 */
export async function listModels(
  openRouterClient: OpenRouterClient,
): Promise<{ content: TextContent[] }> {
  try {
    const apiModels = await openRouterClient.listImageModels();
    // Create a Set of API model IDs for fast lookup
    const apiModelIds = new Set(apiModels.map((model) => model.id));

    // Check for known models that are not in the API response and log warnings
    Object.values(KNOWN_MODELS).forEach((knownModel) => {
      if (!apiModelIds.has(knownModel.id)) {
        logger.warn(
          { modelId: knownModel.id },
          'Known model not found in OpenRouter API, excluding from list',
        );
      }
    });

    const modelMap = new Map<string, { 
      id: string; 
      name: string; 
      pricing?: { prompt?: string; completion?: string }; 
      context_length?: number; 
      description?: string;
      // Additional metadata from known models
      strengths?: string[];
      weaknesses?: string[];
      recommendedUseCases?: string[];
    }>();

    // Start with all API models (these are always included)
    apiModels.forEach((model) => {
      modelMap.set(model.id, {
        id: model.id,
        name: model.name || model.id,
        pricing: model.pricing,
        context_length: model.context_length,
        description: model.description,
      });
    });

    // Merge in metadata from KNOWN_MODELS for models that exist in both
    Object.values(KNOWN_MODELS).forEach((knownModel) => {
      if (apiModelIds.has(knownModel.id)) {
        const existing = modelMap.get(knownModel.id);
        if (existing) {
          modelMap.set(knownModel.id, {
            ...existing,
            name: existing.name || knownModel.name,
            pricing: existing.pricing || knownModel.pricing,
            description: existing.description || knownModel.description,
            strengths: [...knownModel.strengths],
            weaknesses: [...knownModel.weaknesses],
            recommendedUseCases: [...knownModel.recommended_for],
          });
        }
      }
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

    // Format models: use detailed format for known models, simple format for others
    const formatted = combinedModels.map((model) => {
      const knownModel = KNOWN_MODELS[model.id as keyof typeof KNOWN_MODELS];
      if (knownModel) {
        // Use detailed formatting for known models
        return formatKnownModel(knownModel);
      } else {
        // Use simple formatting for API-only models
        return formatApiModel(model);
      }
    }).join('\n\n');

    const knownCount = combinedModels.filter(m => KNOWN_MODELS[m.id as keyof typeof KNOWN_MODELS]).length;
    const totalCount = combinedModels.length;

    return {
      content: [
        {
          type: 'text',
          text: `# Available Image Generation Models\n\nFound ${totalCount} model(s)${knownCount > 0 ? ` (${knownCount} with detailed metadata)` : ''}:\n\n${formatted}\n\n## Usage\n\nTo generate an image, use the \`generate_image\` tool with the **exact Model ID** shown above. Example:\n\`\`\`json\n{\n  "model": "black-forest-labs/flux.2-pro",\n  "prompt": "A beautiful sunset over mountains"\n}\n\`\`\`\n\n**Important:** Use the Model ID exactly as shown (case-sensitive). Models with detailed metadata (strengths, weaknesses, use cases) are well-tested and recommended. Other models are available from OpenRouter but may have limited testing.\n\nUse \`check_model\` to verify a specific model ID before generating images.`,
        },
      ],
    };
  } catch (error) {
    logger.error(
      { tool: 'list_models', error: error instanceof Error ? error.message : String(error) },
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
