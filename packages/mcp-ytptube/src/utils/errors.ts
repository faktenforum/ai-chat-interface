export class VideoTranscriptsError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly isError: boolean = true,
  ) {
    super(message);
    this.name = 'VideoTranscriptsError';
    Object.setPrototypeOf(this, VideoTranscriptsError.prototype);
  }
}

export class InvalidUrlError extends VideoTranscriptsError {
  constructor(message: string) {
    super(message, 'INVALID_URL', true);
    this.name = 'InvalidUrlError';
  }
}

export class InvalidCookiesError extends VideoTranscriptsError {
  constructor(message: string) {
    super(message, 'INVALID_COOKIES', true);
    this.name = 'InvalidCookiesError';
  }
}

export class YTPTubeError extends VideoTranscriptsError {
  constructor(message: string, public readonly status?: string) {
    super(message, 'YTPTUBE_ERROR', true);
    this.name = 'YTPTubeError';
  }
}

export class TranscriptionError extends VideoTranscriptsError {
  constructor(message: string) {
    super(message, 'TRANSCRIPTION_ERROR', true);
    this.name = 'TranscriptionError';
  }
}

export class NotFoundError extends VideoTranscriptsError {
  constructor(message: string) {
    super(message, 'NOT_FOUND', true);
    this.name = 'NotFoundError';
  }
}
