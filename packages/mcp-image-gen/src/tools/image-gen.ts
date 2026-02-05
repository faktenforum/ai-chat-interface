import type { TextContent, ImageContent } from '@modelcontextprotocol/sdk/types.js';
import { GenerateImageSchema, CheckModelSchema } from '../schemas/image-gen.schema.ts';
import { OpenRouterClient } from '../services/openrouter.ts';
import { InvalidInputError, ImageGenError } from '../utils/errors.ts';
import { logger } from '../utils/logger.ts';
import { parseImageData } from '../utils/data-url.ts';
import { KNOWN_MODELS, EXAMPLE_MODEL_ID } from '../constants/models.ts';
import {
  formatKnownModel,
  formatApiModel,
  formatModelDetails,
  buildListModelsUsageText,
} from '../utils/model-formatting.ts';

export type { KnownModel } from '../constants/models.ts';

/** Merged view of a model (known metadata + optional API fields). */
interface MergedModel {
  id: string;
  name: string;
  description?: string;
  pricing?: { prompt?: string; completion?: string };
  context_length?: number;
  strengths?: string[];
  weaknesses?: string[];
  recommendedUseCases?: string[];
}

// --- generate_image ----------------------------------------------------------

export async function generateImage(
  input: unknown,
  openRouterClient: OpenRouterClient,
): Promise<{ content: Array<TextContent | ImageContent> }> {
  try {
    const parsed = GenerateImageSchema.parse(input);
    logger.info(
      { model: parsed.model, hasAspectRatio: !!parsed.aspect_ratio, hasImageSize: !!parsed.image_size },
      'Generating image',
    );

    const imageUrl = await openRouterClient.generateImage(parsed);
    return imageUrlToContent(imageUrl);
  } catch (error) {
    if (error instanceof InvalidInputError) {
      return { content: [{ type: 'text', text: `Error: ${error.message}` }] };
    }
    throw error;
  }
}

function imageUrlToContent(
  imageUrl: string,
): { content: Array<TextContent | ImageContent> } {
  try {
    const { data, mimeType } = parseImageData(imageUrl);
    if (!data?.length) {
      throw new Error('Empty base64 data extracted from image URL');
    }
    return {
      content: [
        { type: 'text', text: 'Image generated successfully.' },
        { type: 'image', data, mimeType },
      ],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      { error: msg, imageUrlLength: imageUrl.length, imageUrlPrefix: imageUrl.slice(0, 50) },
      'Error parsing image data URL',
    );
    throw new ImageGenError(
      `Failed to parse image data: ${msg}`,
      'IMAGE_DATA_PARSE_ERROR',
    );
  }
}

// --- list_models --------------------------------------------------------------

export async function listModels(
  openRouterClient: OpenRouterClient,
): Promise<{ content: TextContent[] }> {
  try {
    const apiModels = await openRouterClient.listImageModels();
    const merged = mergeModelsWithKnown(apiModels);

    if (merged.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No image generation models found. This may indicate an API error or connectivity issue.',
          },
        ],
      };
    }

    const knownCount = merged.filter((m) =>
      Object.prototype.hasOwnProperty.call(KNOWN_MODELS, m.id),
    ).length;
    const totalCount = merged.length;
    const header = `# Available Image Generation Models\n\nFound ${totalCount} model(s)${knownCount > 0 ? ` (${knownCount} with detailed metadata)` : ''}:`;
    const modelsText = merged
      .map((m) => {
        const known = KNOWN_MODELS[m.id as keyof typeof KNOWN_MODELS];
        return known ? formatKnownModel(known) : formatApiModel(m);
      })
      .join('\n\n');
    const usage = buildListModelsUsageText(EXAMPLE_MODEL_ID);

    return {
      content: [
        { type: 'text', text: header },
        { type: 'text', text: modelsText },
        { type: 'text', text: usage },
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

function mergeModelsWithKnown(
  apiModels: Array<{
    id: string;
    name: string;
    description?: string;
    pricing?: { prompt?: string; completion?: string };
    context_length?: number;
  }>,
): MergedModel[] {
  const map = new Map<string, MergedModel>();

  for (const known of Object.values(KNOWN_MODELS)) {
    map.set(known.id, {
      id: known.id,
      name: known.name,
      description: known.description,
      pricing: known.pricing,
      strengths: [...known.strengths],
      weaknesses: [...known.weaknesses],
      recommendedUseCases: [...known.recommended_for],
    });
  }

  for (const api of apiModels) {
    const existing = map.get(api.id);
    if (existing) {
      existing.pricing = api.pricing ?? existing.pricing;
      existing.context_length = api.context_length;
      existing.description = api.description ?? existing.description;
    } else {
      map.set(api.id, {
        id: api.id,
        name: api.name || api.id,
        description: api.description,
        pricing: api.pricing,
        context_length: api.context_length,
      });
    }
  }

  return Array.from(map.values());
}

// --- check_model --------------------------------------------------------------

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

    const known = KNOWN_MODELS[model as keyof typeof KNOWN_MODELS];
    const details = formatModelDetails(result.details!, known);

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
      return { content: [{ type: 'text', text: `Error: ${error.message}` }] };
    }
    throw error;
  }
}
