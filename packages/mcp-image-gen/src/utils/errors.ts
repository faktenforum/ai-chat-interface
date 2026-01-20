export class ImageGenError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly isError: boolean = true,
  ) {
    super(message);
    this.name = 'ImageGenError';
    Object.setPrototypeOf(this, ImageGenError.prototype);
  }
}

export class OpenRouterAPIError extends ImageGenError {
  constructor(message: string, public readonly statusCode?: number) {
    super(message, 'OPENROUTER_API_ERROR', true);
    this.name = 'OpenRouterAPIError';
  }
}

export class InvalidInputError extends ImageGenError {
  constructor(message: string) {
    super(message, 'INVALID_INPUT', true);
    this.name = 'InvalidInputError';
  }
}

export class ModelNotFoundError extends ImageGenError {
  constructor(model: string) {
    super(`Model not found: ${model}`, 'MODEL_NOT_FOUND', true);
    this.name = 'ModelNotFoundError';
  }
}

export class ValidationError extends ImageGenError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', true);
    this.name = 'ValidationError';
  }
}
