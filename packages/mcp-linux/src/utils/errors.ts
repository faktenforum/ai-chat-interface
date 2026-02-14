/**
 * Base error class for mcp-linux
 */
export class McpLinuxError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly isError: boolean = true,
  ) {
    super(message);
    this.name = 'McpLinuxError';
    Object.setPrototypeOf(this, McpLinuxError.prototype);
  }
}

export class UserCreationError extends McpLinuxError {
  constructor(message: string) {
    super(message, 'USER_CREATION_ERROR');
    this.name = 'UserCreationError';
  }
}

export class WorkerError extends McpLinuxError {
  constructor(message: string) {
    super(message, 'WORKER_ERROR');
    this.name = 'WorkerError';
  }
}

export class WorkspaceError extends McpLinuxError {
  constructor(message: string) {
    super(message, 'WORKSPACE_ERROR');
    this.name = 'WorkspaceError';
  }
}

export class TerminalError extends McpLinuxError {
  constructor(message: string) {
    super(message, 'TERMINAL_ERROR');
    this.name = 'TerminalError';
  }
}

export class SecurityError extends McpLinuxError {
  constructor(message: string) {
    super(message, 'SECURITY_ERROR');
    this.name = 'SecurityError';
  }
}
