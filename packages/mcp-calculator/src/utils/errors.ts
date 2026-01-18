export class CalculatorError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly isError: boolean = true,
  ) {
    super(message);
    this.name = 'CalculatorError';
    Object.setPrototypeOf(this, CalculatorError.prototype);
  }
}

export class DivisionByZeroError extends CalculatorError {
  constructor() {
    super('Division by zero is not allowed', 'DIVISION_BY_ZERO', true);
    this.name = 'DivisionByZeroError';
  }
}

export class InvalidInputError extends CalculatorError {
  constructor(message: string) {
    super(message, 'INVALID_INPUT', true);
    this.name = 'InvalidInputError';
  }
}

export class ValidationError extends CalculatorError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', true);
    this.name = 'ValidationError';
  }
}
