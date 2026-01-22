export class FirecrawlError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly isError: boolean = true,
  ) {
    super(message);
    this.name = 'FirecrawlError';
    Object.setPrototypeOf(this, FirecrawlError.prototype);
  }
}

export class FirecrawlAPIError extends FirecrawlError {
  constructor(message: string, public readonly statusCode?: number) {
    super(message, 'API_ERROR', true);
    this.name = 'FirecrawlAPIError';
  }
}

export class FirecrawlValidationError extends FirecrawlError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', true);
    this.name = 'FirecrawlValidationError';
  }
}

export class FirecrawlRateLimitError extends FirecrawlError {
  constructor(message: string = 'Rate limit exceeded') {
    super(message, 'RATE_LIMIT_ERROR', true);
    this.name = 'FirecrawlRateLimitError';
  }
}
