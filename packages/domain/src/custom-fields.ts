import { z } from 'zod';

/**
 * docs/08 §3 — nine field kinds. Enough for real annotation, few enough to stay
 * simple. Custom fields are for annotation and filtering; they deliberately do
 * NOT participate in progress computation. That is what metrics are for, and
 * keeping the boundary sharp is what stops this from re-growing into a formula
 * platform.
 */
export const CUSTOM_FIELD_KINDS = [
  'text',
  'long_text',
  'number',
  'currency',
  'percent',
  'date',
  'select',
  'multi_select',
  'url',
] as const;
export type CustomFieldKind = (typeof CUSTOM_FIELD_KINDS)[number];

export interface CustomFieldOption {
  value: string;
  label: string;
  color?: string;
}

export interface CustomFieldDef {
  id: string;
  objectKind: string;
  /** Immutable. Renaming changes `label`, never this (docs/08 §3). */
  key: string;
  label: string;
  kind: CustomFieldKind;
  required: boolean;
  /** Excluded from AI context. */
  private: boolean;
  defaultValue?: unknown;
  options?: CustomFieldOption[];
  /** `number` / `currency` / `percent`. */
  min?: number;
  max?: number;
  /** `currency` only: ISO code. Values are stored in minor units. */
  currency?: string;
  sortOrder: number;
}

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

export function isValidFieldKey(key: string): boolean {
  return KEY_PATTERN.test(key) && !key.startsWith('__');
}

/** Where values go when a field is deleted, so nothing is silently destroyed. */
export const ARCHIVED_VALUES_KEY = '__archived';

function baseSchema(def: CustomFieldDef): z.ZodTypeAny {
  switch (def.kind) {
    case 'text':
      return z.string().max(500);
    case 'long_text':
      return z.string().max(50_000);
    case 'url':
      return z.string().url().max(2000);
    case 'number':
    case 'currency': {
      let s = z.number().finite();
      if (def.min !== undefined) s = s.min(def.min);
      if (def.max !== undefined) s = s.max(def.max);
      // Money is integer minor units, never a float (docs/11 conventions).
      return def.kind === 'currency' ? s.int() : s;
    }
    case 'percent': {
      const min = def.min ?? 0;
      const max = def.max ?? 100;
      return z.number().finite().min(min).max(max);
    }
    case 'date':
      // UTC epoch ms, formatted only at the edge.
      return z.number().int();
    case 'select': {
      const values = (def.options ?? []).map((o) => o.value);
      return values.length > 0 ? z.enum(values as [string, ...string[]]) : z.string();
    }
    case 'multi_select': {
      const values = (def.options ?? []).map((o) => o.value);
      const item =
        values.length > 0 ? z.enum(values as [string, ...string[]]) : z.string();
      return z.array(item).max(50);
    }
  }
}

/**
 * Builds a validator for one object's `customFields` bag from its definitions.
 * Unknown keys are stripped rather than rejected, so a value left behind by a
 * just-deleted field cannot make an otherwise valid record unsaveable.
 */
export function compileCustomFields(
  defs: readonly CustomFieldDef[],
): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const def of defs) {
    const schema = baseSchema(def);
    shape[def.key] = def.required ? schema : schema.optional().nullable();
  }

  // Archived values from deleted fields ride along untouched.
  shape[ARCHIVED_VALUES_KEY] = z.record(z.string(), z.unknown()).optional();

  return z.object(shape).strip() as z.ZodType<Record<string, unknown>>;
}
