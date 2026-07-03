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

