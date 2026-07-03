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

/** Usage block; `cost` (USD) is present when the request opts in via `usage.include`. */
interface OpenRouterUsage {
  cost?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
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
  usage?: OpenRouterUsage;
}

/** Request body for POST /chat/completions (image generation). */
interface ChatCompletionRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  modalities?: string[];
  response_modalities?: string[];
  image_config?: { aspect_ratio?: string; image_size?: string };
  usage?: { include: boolean };
}

/** A generated image plus the provider cost, when OpenRouter reports one. */
export interface GeneratedImage {
  imageUrl: string;
  /** Provider cost in USD (OpenRouter credits are 1:1 USD). Undefined if not reported. */
  costUsd?: number;
}

const REQUEST_TIMEOUT_MS = 120_000;
const NO_ENDPOINTS_PATTERN = /no endpoints found.*output modalities|modalities.*image/i;

/** Error carrying the HTTP status so callers can branch (e.g. no-endpoints 404 retry). */
class OpenRouterHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'OpenRouterHttpError';
  }
}

export function extractImageUrl(response: OpenRouterImageResponse): string {
  const message = response.choices?.[0]?.message;
  let url = message?.images?.[0]?.image_url?.url;

  if (!url && Array.isArray(message?.content)) {
    url = message.content.find((c) => c.type === 'image_url' && c.image_url?.url)
      ?.image_url?.url;
  }

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

function errorMessageFromBody(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const err = (body as { error?: { message?: string } }).error;
    if (err?.message) {
      return err.message;
    }
  }
  return fallback;
}

// --- Client -------------------------------------------------------------------

export class OpenRouterClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(apiKey: string, baseUrl: string = 'https://openrouter.ai/api/v1') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://librechat.ai',
    };
  }

  async generateImage(input: GenerateImageInput): Promise<GeneratedImage> {
    const { prompt, model, aspect_ratio, image_size } = input;

    this.warnUnsupportedOptions(model, aspect_ratio, image_size);

    const requestBody = this.buildRequestBody({ model, prompt, aspect_ratio, image_size });

    logger.debug(
      { model, modalities: requestBody.modalities ?? requestBody.response_modalities },
      'Generating image',
    );

    try {
      const response = await this.post<OpenRouterImageResponse>('/chat/completions', requestBody);
      return this.toGeneratedImage(response);
    } catch (error) {
      const status = error instanceof OpenRouterHttpError ? error.status : undefined;
      const message = error instanceof Error ? error.message : String(error);
      const isNoEndpoints404 = status === 404 && NO_ENDPOINTS_PATTERN.test(message);

      if (isNoEndpoints404 && requestBody.modalities?.includes('text')) {
        logger.info({ model }, 'Retrying with modalities ["image"] only');
        requestBody.modalities = ['image'];
        try {
          const retry = await this.post<OpenRouterImageResponse>('/chat/completions', requestBody);
          return this.toGeneratedImage(retry);
        } catch (retryErr) {
          logger.error({ error: String(retryErr), model }, 'Retry failed');
          throw new OpenRouterAPIError(noEndpointMessage(model), status);
        }
      }

      logger.error({ error: message, model }, 'Error generating image');
      if (isNoEndpoints404) {
        throw new OpenRouterAPIError(noEndpointMessage(model), status);
      }
      if (error instanceof OpenRouterAPIError) {
        throw error;
      }
      throw new OpenRouterAPIError(`OpenRouter API error: ${message}`, status);
    }
  }

  async listModels(): Promise<OpenRouterModel[]> {
    try {
      const res = await this.get<OpenRouterModelsResponse>('/models');
      return res.data ?? [];
    } catch (error) {
      const status = error instanceof OpenRouterHttpError ? error.status : undefined;
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, 'Error listing models');
      throw new OpenRouterAPIError(`OpenRouter API error: ${message}`, status);
    }
  }

  async listImageModels(): Promise<OpenRouterModel[]> {
    const all = await this.listModels();
    const knownIds = new Set(Object.keys(KNOWN_MODELS));
    return all.filter(
      (m) => m.architecture?.output_modalities?.includes('image') || knownIds.has(m.id),
    );
  }

  async checkModel(modelId: string): Promise<{
    exists: boolean;
    supportsImageGeneration: boolean;
    details?: OpenRouterModel;
  }> {
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

    return { exists: true, supportsImageGeneration: supportsImage, details: model };
  }

  private toGeneratedImage(response: OpenRouterImageResponse): GeneratedImage {
    const imageUrl = extractImageUrl(response);
    const costUsd =
      typeof response.usage?.cost === 'number' ? response.usage.cost : undefined;
    return { imageUrl, costUsd };
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: JSON.stringify(body) });
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(this.baseUrl + path, {
        ...init,
        headers: this.headers,
        signal: controller.signal,
      });
      const text = await res.text();
      const parsed: unknown = text ? JSON.parse(text) : undefined;
      if (!res.ok) {
        throw new OpenRouterHttpError(
          errorMessageFromBody(parsed, text || res.statusText),
          res.status,
        );
      }
      return parsed as T;
    } catch (error) {
      if (error instanceof OpenRouterHttpError) {
        throw error;
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new OpenRouterAPIError(`OpenRouter request timed out after ${REQUEST_TIMEOUT_MS}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
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
    const useAspectRatio = Boolean(aspect_ratio) && this.supportsAspectRatio(model);
    const useImageSize = Boolean(image_size) && this.supportsImageSize(model);

    const body: ChatCompletionRequest = {
      model,
      messages: [{ role: 'user', content: prompt }],
      usage: { include: true },
    };

    if (modality === 'response_modalities') {
      body.response_modalities = ['image'];
    } else if (modality === 'image_only') {
      body.modalities = ['image'];
    } else {
      body.modalities = ['image', 'text'];
    }

    if (useAspectRatio || useImageSize) {
      body.image_config = {};
      if (useAspectRatio) body.image_config.aspect_ratio = aspect_ratio;
      if (useImageSize) body.image_config.image_size = image_size;
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
      m = models.find((x) => x.id === v || x.id.toLowerCase() === v.toLowerCase());
      if (m) return m;
    }
    return undefined;
  }

  private findKnownModel(
    variations: string[],
  ): (typeof KNOWN_MODELS)[keyof typeof KNOWN_MODELS] | undefined {
    for (const v of variations) {
      const key = Object.keys(KNOWN_MODELS).find((k) => k.toLowerCase() === v.toLowerCase());
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
