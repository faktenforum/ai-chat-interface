export class ChefkochError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly isError: boolean = true,
  ) {
    super(message);
    this.name = 'ChefkochError';
    Object.setPrototypeOf(this, ChefkochError.prototype);
  }
}

export class RecipeNotFoundError extends ChefkochError {
  constructor(message: string) {
    super(message, 'RECIPE_NOT_FOUND', true);
    this.name = 'RecipeNotFoundError';
  }
}

export class PlusRecipeBlockedError extends ChefkochError {
  constructor(message: string = 'Recipe is Chefkoch Plus (content blocked)') {
    super(message, 'PLUS_RECIPE_BLOCKED', true);
    this.name = 'PlusRecipeBlockedError';
  }
}

export class ValidationError extends ChefkochError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', true);
    this.name = 'ValidationError';
  }
}
