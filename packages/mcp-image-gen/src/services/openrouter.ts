import axios, { type AxiosInstance } from 'axios';
import { logger } from '../utils/logger.ts';
import { OpenRouterAPIError } from '../utils/errors.ts';
import type { GenerateImageInput } from '../schemas/image-gen.schema.ts';
import {
  KNOWN_MODELS,
  MODEL_ID_PREFIXES,
  EXAMPLE_MODEL_ID,
  type ModalityRequest,
} from '../constants/models.ts';

// --- OpenRouter API types ----------------------------------------------------

export interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  pricing?: { prompt?: string; completion?: string };
  context_length?: number;
  architecture?: {
    modality?: string;
    tokenizer?: string;
    instruct_type?: string;
    output_modalities?: string[];
  };
}

interface OpenRouterModelsResponse {
  data: OpenRouterModel[];
}

interface OpenRouterImageResponse {
  choices: Array<{
    message: {
      images?: Array<{ type: string; image_url: { url: string } }>;
      content?: Array<{
        type: string;
        text?: string;
        image_url?: { url: string };
      }>;
    };
  }>;
}

/** Request body for POST /chat/completions (image generation). */
interface ChatCompletionRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  modalities?: string[];
  response_modalities?: string[];
  image_config?: { aspect_ratio?: string; image_size?: string };
}

// --- Helpers ------------------------------------------------------------------

const NO_ENDPOINTS_PATTERN = /no endpoints found.*output modalities|modalities.*image/i;

function extractImageFromResponse(response: {
  data: OpenRouterImageResponse;
}): string {
  const message = response.data.choices?.[0]?.message;
  let images = message?.images ?? [];

  if (images.length === 0 && Array.isArray(message?.content)) {
    const item = message.content.find(
      (c) => c.type === 'image_url' && c.image_url?.url,
    );
    if (item?.image_url?.url) {
      images = [{ type: 'image_url', image_url: { url: item.image_url.url } }];
    }
  }

  const url = images[0]?.image_url?.url;
  if (!url) {
    throw new OpenRouterAPIError(
      'No image data in OpenRouter response. The model may not support image generation or the request failed.',
    );
  }

  return url.startsWith('data:') ? url : `data:image/png;base64,${url}`;
}

function noEndpointMessage(modelId: string): string {
  return `Model "${modelId}" is not available for image generation on OpenRouter (no endpoint for image output). Use list_models or check_model to pick a supported model (e.g. ${EXAMPLE_MODEL_ID}).`;
}

function parseAxiosError(error: unknown): {
  message: string;
  status?: number;
  isNoEndpoints404: boolean;
} {
  if (!axios.isAxiosError(error)) {
    return {
      message: error instanceof Error ? error.message : String(error),
      isNoEndpoints404: false,
    };
  }
  const data = error.response?.data ?? error.message;
  const message =
    typeof data === 'object' && data !== null && 'error' in data
      ? String((data as { error?: { message?: string } }).error?.message ?? '')
      : String(data);
  const status = error.response?.status;
  const isNoEndpoints404 =
    status === 404 && NO_ENDPOINTS_PATTERN.test(message);
  return { message, status, isNoEndpoints404 };
}

// --- Client -------------------------------------------------------------------

export class OpenRouterClient {
  private readonly client: AxiosInstance;
  private readonly baseUrl: string;

  constructor(
    apiKey: string,
    baseUrl: string = 'https://openrouter.ai/api/v1',
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://librechat.ai',
      },
      timeout: 120_000,
    });
  }

  async generateImage(input: GenerateImageInput): Promise<string> {
    const { prompt, model, aspect_ratio, image_size } = input;

    this.warnUnsupportedOptions(model, aspect_ratio, image_size);

    const requestBody = this.buildRequestBody({
      model,
      prompt,
      aspect_ratio,
      image_size,
    });

    logger.debug(
      {
        model,
        modalities: requestBody.modalities ?? requestBody.response_modalities,
      },
      'Generating image',
    );

    try {
      const response = await this.client.post<OpenRouterImageResponse>(
        '/chat/completions',
        requestBody,
      );
      return extractImageFromResponse(response);
    } catch (error) {
      const { message, status, isNoEndpoints404 } = parseAxiosError(error);

      if (isNoEndpoints404 && requestBody.modalities?.includes('text')) {
        logger.info({ model }, 'Retrying with modalities ["image"] only');
        requestBody.modalities = ['image'];
        try {
          const retry = await this.client.post<OpenRouterImageResponse>(
            '/chat/completions',
            requestBody,
          );
          return extractImageFromResponse(retry);
        } catch (retryErr) {
          logger.error({ error: parseAxiosError(retryErr), model }, 'Retry failed');
          throw new OpenRouterAPIError(noEndpointMessage(model), status);
        }
      }

      logger.error({ error: message, model }, 'Error generating image');
      if (isNoEndpoints404) {
        throw new OpenRouterAPIError(noEndpointMessage(model), status);
      }
      throw new OpenRouterAPIError(
        `OpenRouter API error: ${typeof message === 'string' ? message : JSON.stringify(message)}`,
        status,
      );
    }
  }

  async listModels(): Promise<OpenRouterModel[]> {
    try {
      const res = await this.client.get<OpenRouterModelsResponse>('/models');
      return res.data.data ?? [];
    } catch (error) {
      const { message, status } = parseAxiosError(error);
      logger.error({ error: message }, 'Error listing models');
      throw new OpenRouterAPIError(
        `OpenRouter API error: ${message}`,
        status,
      );
    }
  }

  async listImageModels(): Promise<OpenRouterModel[]> {
    const all = await this.listModels();
    const knownIds = new Set(Object.keys(KNOWN_MODELS));
    return all.filter(
      (m) =>
        m.architecture?.output_modalities?.includes('image') ||
        knownIds.has(m.id),
    );
  }

  async checkModel(modelId: string): Promise<{
    exists: boolean;
    supportsImageGeneration: boolean;
    details?: OpenRouterModel;
  }> {
    try {
      const models = await this.listModels();
      const variations = this.normalizeModelId(modelId);

      const model = this.findModel(models, modelId, variations);
      const knownModel = this.findKnownModel(variations);

      if (knownModel && !model) {
        return {
          exists: true,
          supportsImageGeneration: true,
          details: {
            id: knownModel.id,
            name: knownModel.name,
            description: knownModel.description,
            pricing: knownModel.pricing,
          } as OpenRouterModel,
        };
      }

      if (!model) {
        return { exists: false, supportsImageGeneration: false };
      }

      const supportsImage =
        (model.architecture?.output_modalities?.includes('image') ?? false) ||
        knownModel !== undefined;

      return {
        exists: true,
        supportsImageGeneration: supportsImage,
        details: model,
      };
    } catch (error) {
      logger.error({ error, modelId }, 'Error checking model');
      throw error;
    }
  }

  private warnUnsupportedOptions(
    model: string,
    aspect_ratio?: string,
    image_size?: string,
  ): void {
    if (aspect_ratio && !this.supportsAspectRatio(model)) {
      logger.warn({ model, aspect_ratio }, 'Aspect ratio not supported; ignoring');
    }
    if (image_size && !this.supportsImageSize(model)) {
      logger.warn({ model, image_size }, 'Image size not supported; ignoring');
    }
  }

  private buildRequestBody(input: {
    model: string;
    prompt: string;
    aspect_ratio?: string;
    image_size?: string;
  }): ChatCompletionRequest {
    const { model, prompt, aspect_ratio, image_size } = input;
    const modality = this.getModalityRequest(model);
    const supportsAr = this.supportsAspectRatio(model);
    const supportsSize = this.supportsImageSize(model);

    const body: ChatCompletionRequest = {
      model,
      messages: [{ role: 'user', content: prompt }],
    };

    if (modality === 'response_modalities') {
      body.response_modalities = ['image'];
    } else if (modality === 'image_only') {
      body.modalities = ['image'];
    } else {
      body.modalities = ['image', 'text'];
    }

    if (supportsAr && (aspect_ratio || image_size)) {
      body.image_config = {};
      if (aspect_ratio) body.image_config.aspect_ratio = aspect_ratio;
      if (image_size && supportsSize) body.image_config.image_size = image_size;
    }

    return body;
  }

  private normalizeModelId(modelId: string): string[] {
    const normalized = modelId.toLowerCase().trim();
    const out: string[] = [modelId, normalized];
    if (!normalized.includes('/')) {
      for (const [key, prefix] of Object.entries(MODEL_ID_PREFIXES)) {
        if (normalized.includes(key)) {
          out.push(`${prefix}/${normalized}`, `${prefix}/${modelId}`);
        }
      }
    }
    return out;
  }

  private findModel(
    models: OpenRouterModel[],
    modelId: string,
    variations: string[],
  ): OpenRouterModel | undefined {
    let m = models.find((x) => x.id === modelId);
    if (m) return m;
    const lower = modelId.toLowerCase();
    m = models.find((x) => x.id.toLowerCase() === lower);
    if (m) return m;
    for (const v of variations) {
      m = models.find(
        (x) =>
          x.id === v || x.id.toLowerCase() === v.toLowerCase(),
      );
      if (m) return m;
    }
    return undefined;
  }

  private findKnownModel(
    variations: string[],
  ): (typeof KNOWN_MODELS)[keyof typeof KNOWN_MODELS] | undefined {
    for (const v of variations) {
      const key = Object.keys(KNOWN_MODELS).find(
        (k) => k.toLowerCase() === v.toLowerCase(),
      );
      if (key) return KNOWN_MODELS[key as keyof typeof KNOWN_MODELS];
    }
    return undefined;
  }

  private getModalityRequest(modelId: string): ModalityRequest {
    const known = KNOWN_MODELS[modelId as keyof typeof KNOWN_MODELS];
    return known?.modalityRequest ?? 'image_and_text';
  }

  private supportsAspectRatio(modelId: string): boolean {
    const known = KNOWN_MODELS[modelId as keyof typeof KNOWN_MODELS];
    return known?.supportsAspectRatio ?? false;
  }

  private supportsImageSize(modelId: string): boolean {
    const known = KNOWN_MODELS[modelId as keyof typeof KNOWN_MODELS];
    return known?.supportsImageSize ?? false;
  }
}
