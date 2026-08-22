/**
 * The error hierarchy lives in `@aryesh/domain` so the lowest layer can raise
 * domain errors without importing upward (docs/11 dependency rule). Re-exported
 * here so API-facing code has one import site.
 */
export {
  AppError,
  NotFoundError,
  NotMeasurableError,
  ERROR_CODES,
  type ErrorCode,
} from '@aryesh/domain';
