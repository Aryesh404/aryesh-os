/**
 * One error hierarchy with stable machine-readable codes (docs/01 §6).
 * Never throw strings; never swallow.
 */

export const ERROR_CODES = [
  'NOT_FOUND',
  'INVALID_INPUT',
  'CONFLICT',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_MEASURABLE',
  'CYCLE_DETECTED',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

export class NotFoundError extends AppError {
  constructor(kind: string, id: string) {
    super('NOT_FOUND', `${kind} ${id} not found`, { kind, id });
    this.name = 'NotFoundError';
  }
}

/**
 * Raised when the honest answer is "this cannot be expressed as a number yet"
 * — insufficient history, an unbounded metric used as a level contributor, a
 * goal with no satisfied contributors. See docs/04 §2.
 */
export class NotMeasurableError extends AppError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('NOT_MEASURABLE', message, details);
    this.name = 'NotMeasurableError';
  }
}
