/**
 * docs/01 §5 — explainability is a return type, not a log.
 *
 * Every computed number in Aryesh OS is returned together with its derivation,
 * so "click a number, see what made it" is guaranteed by the type system rather
 * than by anyone remembering to log it.
 */

export interface EntityRef {
  kind: string;
  id: string;
}

export interface ExplainedInput {
  ref: EntityRef;
  label: string;
  /** The contributor's normalised 0..1 value, or its raw reading. */
  value: number;
  /** Normalised weight actually applied. Absent for non-weighted derivations. */
  weight?: number;
  /** Human-readable note, e.g. "₹1.4L of ₹5L, baseline ₹0". */
  detail?: string;
}

export type DerivationMethod =
  | 'weighted-mean'
  | 'metric-normalisation'
  | 'rate-vs-expected'
  | 'milestone-ratio'
  | 'habit-consistency'
  | 'rollup'
  | 'manual'
  | 'linear-projection'
  | 'compounding-projection'
  | 'velocity'
  | 'passthrough';

export interface Explained<T> {
  value: T;
  method: DerivationMethod;
  inputs: ExplainedInput[];
  /** 0..1. Drives hollow rings, widened bands, and insight suppression. */
  confidence: number;
  /** Plain-language caveats: "metric stale 14d", "only 3 data points". */
  caveats: string[];
}

export function explained<T>(
  value: T,
  method: DerivationMethod,
  opts: {
    inputs?: ExplainedInput[];
    confidence?: number;
    caveats?: string[];
  } = {},
): Explained<T> {
  return {
    value,
    method,
    inputs: opts.inputs ?? [],
    confidence: opts.confidence ?? 1,
    caveats: opts.caveats ?? [],
  };
}
