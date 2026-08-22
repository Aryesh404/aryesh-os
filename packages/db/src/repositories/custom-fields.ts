import { and, eq, isNull } from 'drizzle-orm';
import {
  AppError,
  ARCHIVED_VALUES_KEY,
  compileCustomFields,
  isValidFieldKey,
  type CustomFieldDef,
} from '@aryesh/domain';

import { customFieldDefs } from '../schema/index.js';
import type { Db } from '../client.js';
import { createRepository, type Ctx, type RepoDeps } from './base.js';

type DefRow = typeof customFieldDefs.$inferSelect;

const toDef = (row: DefRow): CustomFieldDef => ({
  id: row.id,
  objectKind: row.objectKind,
  key: row.key,
  label: row.label,
  kind: row.kind,
  required: row.required,
  private: row.private,
  ...(row.defaultValue != null ? { defaultValue: row.defaultValue } : {}),
  ...(row.options ? { options: row.options } : {}),
  ...(row.min != null ? { min: row.min } : {}),
  ...(row.max != null ? { max: row.max } : {}),
  ...(row.currency ? { currency: row.currency } : {}),
  sortOrder: row.sortOrder,
});

/**
 * Compiles and caches a Zod validator per object kind. The cache is invalidated
 * whenever a definition changes, which is rare — a definition edit is a
 * deliberate act, while validation runs on every write.
 */
export function createCustomFieldValidator(db: Db) {
  const cache = new Map<string, ReturnType<typeof compileCustomFields>>();

  const load = async (objectKind: string) => {
    const cached = cache.get(objectKind);
    if (cached) return cached;
    const rows = await db
      .select()
      .from(customFieldDefs)
      .where(
        and(eq(customFieldDefs.objectKind, objectKind), isNull(customFieldDefs.deletedAt)),
      );
    const schema = compileCustomFields(rows.map(toDef));
    cache.set(objectKind, schema);
    return schema;
  };

  return {
    invalidate(objectKind?: string) {
      if (objectKind) cache.delete(objectKind);
      else cache.clear();
    },

    async validate(objectKind: string, values: unknown): Promise<Record<string, unknown>> {
      const schema = await load(objectKind);
      const result = schema.safeParse(values ?? {});
      if (!result.success) {
        throw new AppError(
          'INVALID_INPUT',
          `Invalid custom fields on ${objectKind}`,
          {
            objectKind,
            issues: result.error.issues.map((i) => ({
              field: i.path.join('.'),
              message: i.message,
            })),
          },
        );
      }
      return result.data;
    },
  };
}

export type CustomFieldValidator = ReturnType<typeof createCustomFieldValidator>;

export function createCustomFieldDefsRepository(
  deps: RepoDeps,
  validator: CustomFieldValidator,
) {
  const base = createRepository(deps, customFieldDefs, 'custom_field_def', {
    revisioned: true,
  });

  return {
    ...base,

    async define(
      input: Omit<CustomFieldDef, 'id'> & { id?: string },
      ctx: Ctx,
    ): Promise<DefRow> {
      if (!isValidFieldKey(input.key)) {
        throw new AppError(
          'INVALID_INPUT',
          `'${input.key}' is not a valid field key — use lowercase letters, digits, and underscores`,
          { key: input.key },
        );
      }
      const row = await base.create(input as never, ctx);
      validator.invalidate(input.objectKind);
      return row as DefRow;
    },

    /**
     * Deleting a field never deletes its data — values move to
     * `customFields.__archived[key]` and return if the field does (docs/08 §3).
     * Safe experimentation is what makes customization actually get used.
     */
    async retire(id: string, ctx: Ctx): Promise<{ archivedUnder: string }> {
      const def = (await base.getById(id)) as DefRow;
      await base.softDelete(id, ctx);
      validator.invalidate(def.objectKind);
      return { archivedUnder: `${ARCHIVED_VALUES_KEY}.${def.key}` };
    },

    async listFor(objectKind: string): Promise<CustomFieldDef[]> {
      const rows = (await base.list({
        where: eq(customFieldDefs.objectKind, objectKind),
      })) as DefRow[];
      return rows.sort((a, b) => a.sortOrder - b.sortOrder).map(toDef);
    },
  };
}

export type CustomFieldDefsRepository = ReturnType<typeof createCustomFieldDefsRepository>;
