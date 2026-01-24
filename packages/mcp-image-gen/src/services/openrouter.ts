import axios, { type AxiosInstance } from 'axios';
import { logger } from '../utils/logger.ts';
import { OpenRouterAPIError } from '../utils/errors.ts';
import type { GenerateImageInput } from '../schemas/image-gen.schema.ts';
import { KNOWN_MODELS } from '../constants/models.ts';

export interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
  context_length?: number;
  architecture?: {
    modality?: string;
    tokenizer?: string;
    instruct_type?: string;
    output_modalities?: string[];
  };
}

export interface OpenRouterModelsResponse {
  data: OpenRouterModel[];
}

export interface OpenRouterImageResponse {
  choices: Array<{
    message: {
      images?: Array<{
        type: string;
        image_url: {
          url: string;
        };
      }>;
      content?: string | Array<{
        type: string;
        text?: string;
        image_url?: {
          url: string;
        };
      }>;
    };
  }>;
}

export class OpenRouterClient {
  private client: AxiosInstance;
  private baseUrl: string;
  private apiKey: string;

  constructor(apiKey: string, baseUrl: string = 'https://openrouter.ai/api/v1') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');

    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://librechat.ai',
      },
      timeout: 120000, // 120 seconds for image generation
    });
  }

  /**
   * Generate an image using OpenRouter API
   */
  async generateImage(input: GenerateImageInput): Promise<string> {
    const { prompt, model, aspect_ratio, image_size } = input;

    // Check if model supports aspect ratio
    const supportsAspectRatio = this.supportsAspectRatio(model);
    const supportsImageSize = this.supportsImageSize(model);

    if (aspect_ratio && !supportsAspectRatio) {
      logger.warn(
        { model, aspect_ratio },
        'Aspect ratio is typically only supported for Gemini models. Ignoring aspect_ratio.',
      );
    }

    if (image_size && !supportsImageSize) {
      logger.warn(
        { model, image_size },
        'Image size is typically only supported for Gemini models. Ignoring image_size.',
      );
    }

    // For Gemini models, use response_modalities to explicitly request image output
    const isGeminiModel = model.toLowerCase().includes('gemini');
    
    const requestBody: {
      model: string;
      messages: Array<{ role: string; content: string }>;
      modalities?: string[];
      response_modalities?: string[];
      image_config?: { aspect_ratio?: string; image_size?: string };
    } = {
      model,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    };

    // Set modalities based on model type
    if (isGeminiModel) {
      // For Gemini, explicitly request image in response
      requestBody.response_modalities = ['image'];
    } else {
      // For other models, use modalities to indicate we want image output
      requestBody.modalities = ['image', 'text'];
    }

    if (supportsAspectRatio && (aspect_ratio || image_size)) {
      requestBody.image_config = {};
      if (aspect_ratio) {
        requestBody.image_config.aspect_ratio = aspect_ratio;
      }
      if (image_size) {
        requestBody.image_config.image_size = image_size;
      }
    }

    logger.debug({ model, hasAspectRatio: !!aspect_ratio, hasImageSize: !!image_size }, 'Generating image');

    try {
      const response = await this.client.post<OpenRouterImageResponse>('/chat/completions', requestBody);
      const message = response.data.choices?.[0]?.message;
      
      // Log response structure for debugging (truncate large responses)
      const responseStr = JSON.stringify(response.data);
      logger.debug({
        fullResponse: responseStr.length > 2000 ? responseStr.substring(0, 2000) + '... (truncated)' : responseStr,
        hasMessage: !!message,
        messageKeys: message ? Object.keys(message) : [],
        messageContentType: typeof message?.content,
        messageContentIsArray: Array.isArray(message?.content),
      }, 'OpenRouter API response received');

      // Try to extract image from images array first
      let images = message?.images || [];
      
      // If no images array, try to extract from content array (alternative response format)
      if (images.length === 0 && Array.isArray(message?.content)) {
        logger.debug('No images array found, checking content array');
        const imageContent = message.content.find(
          (item) => item.type === 'image_url' && item.image_url?.url
        );
        if (imageContent?.image_url?.url) {
          images = [{
            type: 'image_url',
            image_url: {
              url: imageContent.image_url.url,
            },
          }];
          logger.debug('Found image in content array');
        }
      }

      logger.debug({
        imagesCount: images.length,
        hasImageUrl: images[0]?.image_url ? true : false,
        messageContent: typeof message?.content === 'string' ? message.content.substring(0, 200) : 'not a string',
      }, 'Image extraction attempt');

      if (!images || images.length === 0 || !images[0]?.image_url) {
        // Log full response for debugging
        const fullResponseStr = JSON.stringify(response.data, null, 2);
        logger.error({
          responseData: fullResponseStr.substring(0, 2000),
          message: message ? JSON.stringify(message, null, 2).substring(0, 2000) : 'no message',
          messageType: typeof message?.content,
          isContentArray: Array.isArray(message?.content),
        }, 'No image data in OpenRouter response');
        throw new OpenRouterAPIError(
          'No image data returned from OpenRouter API. The model may not support image generation or the request may have failed. Check the logs for the full response structure.',
        );
      }

      // Extract base64 from data URL (format: "data:image/png;base64,...")
      const imageUrl = images[0].image_url.url;

      if (!imageUrl || typeof imageUrl !== 'string') {
        logger.error({ imageUrl: typeof imageUrl, imageUrlValue: imageUrl }, 'Invalid image URL type');
        throw new OpenRouterAPIError('Invalid image URL format returned from OpenRouter API');
      }

      // Ensure imageUrl is in the correct format
      if (!imageUrl.startsWith('data:')) {
        logger.debug({ urlLength: imageUrl.length }, 'Adding data URL prefix to base64');
        return `data:image/png;base64,${imageUrl}`;
      }

      logger.debug({ urlPrefix: imageUrl.substring(0, 30) + '...', urlLength: imageUrl.length }, 'Returning data URL');
      return imageUrl;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const errorDetails = error.response?.data || error.message;
        logger.error({ error: errorDetails, model }, 'Error generating image');
        throw new OpenRouterAPIError(
          `OpenRouter API error: ${typeof errorDetails === 'string' ? errorDetails : JSON.stringify(errorDetails)}`,
          error.response?.status,
        );
      }
      throw error;
    }
  }

  /**
   * List all available models from OpenRouter API
   */
  async listModels(): Promise<OpenRouterModel[]> {
    try {
      const response = await this.client.get<OpenRouterModelsResponse>('/models');
      return response.data.data || [];
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const errorDetails = error.response?.data || error.message;
        logger.error({ error: errorDetails }, 'Error listing models');
        throw new OpenRouterAPIError(
          `OpenRouter API error: ${typeof errorDetails === 'string' ? errorDetails : JSON.stringify(errorDetails)}`,
          error.response?.status,
        );
      }
      throw error;
    }
  }

  /**
   * Get image generation models (filtered by output_modalities or known models)
   */
  async listImageModels(): Promise<OpenRouterModel[]> {
    const allModels = await this.listModels();
    const knownModelIds = new Set(Object.keys(KNOWN_MODELS));
    
    return allModels.filter(
      (model) => 
        model.architecture?.output_modalities?.includes('image') ||
        knownModelIds.has(model.id),
    );
  }

  /**
   * Check if a specific model exists and supports image generation
   */
  async checkModel(modelId: string): Promise<{
    exists: boolean;
    supportsImageGeneration: boolean;
    details?: OpenRouterModel;
  }> {
    try {
      const models = await this.listModels();
      const model = models.find((m) => m.id === modelId);
      const isKnownModel = KNOWN_MODELS[modelId as keyof typeof KNOWN_MODELS] !== undefined;

      // If model is in KNOWN_MODELS, it definitely supports image generation
      if (isKnownModel && !model) {
        // Model is known but not in API - might be deprecated or temporarily unavailable
        return {
          exists: false,
          supportsImageGeneration: false,
        };
      }

      if (!model) {
        return {
          exists: false,
          supportsImageGeneration: false,
        };
      }

      // Check if model supports image generation via output_modalities or if it's a known model
      const supportsImageGeneration = 
        (model.architecture?.output_modalities?.includes('image') ?? false) ||
        isKnownModel;

      return {
        exists: true,
        supportsImageGeneration,
        details: model,
      };
    } catch (error) {
      logger.error({ error, modelId }, 'Error checking model');
      throw error;
    }
  }

  private supportsAspectRatio(modelId: string): boolean {
    const knownModel = KNOWN_MODELS[modelId as keyof typeof KNOWN_MODELS];
    return knownModel?.supportsAspectRatio ?? modelId.toLowerCase().includes('gemini');
  }

  private supportsImageSize(modelId: string): boolean {
    const knownModel = KNOWN_MODELS[modelId as keyof typeof KNOWN_MODELS];
    return knownModel?.supportsImageSize ?? modelId.toLowerCase().includes('gemini');
  }
}
