import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, TEST_ACTOR, type TestDb } from '../testing.js';

let t: TestDb;
let areaId: string;

beforeEach(async () => {
  t = await createTestDb();
  areaId = (
    await t.repos.areas.create(
      { name: 'Business', color: '#38bdf8', sortOrder: 0 },
      TEST_ACTOR,
    )
  ).id;
});
afterEach(() => t.close());

type DefineInput = Parameters<typeof t.repos.customFieldDefs.define>[0];

/**
 * `exactOptionalPropertyTypes` makes `{ options: undefined }` different from an
 * absent key, so an override of `undefined` means "drop this", not "set it to
 * undefined".
 */
const defineField = (over: Record<string, unknown> = {}) => {
  const merged: Record<string, unknown> = {
    objectKind: 'project',
    key: 'risk_level',
    label: 'Risk level',
    kind: 'select',
    required: false,
    private: false,
    options: [
      { value: 'low', label: 'Low' },
      { value: 'high', label: 'High' },
    ],
    sortOrder: 0,
    ...over,
  };
  for (const [k, v] of Object.entries(merged)) if (v === undefined) delete merged[k];
  return t.repos.customFieldDefs.define(merged as unknown as DefineInput, TEST_ACTOR);
};

describe('defining fields', () => {
  it('rejects keys that would break references', async () => {
    await expect(defineField({ key: 'Risk Level' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await expect(defineField({ key: '__archived' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('keeps the key stable when the label is renamed', async () => {
    const def = await defineField();
    await t.repos.customFieldDefs.update(def.id, { label: 'Delivery risk' }, TEST_ACTOR);

    const [after] = await t.repos.customFieldDefs.listFor('project');
    expect(after?.key).toBe('risk_level');
    expect(after?.label).toBe('Delivery risk');
  });
});

describe('validation on write', () => {
  it('accepts a valid value and rejects one outside the options', async () => {
    await defineField();

    const ok = await t.repos.projects.create(
      { areaId, name: 'Retainer platform', customFields: { risk_level: 'high' } },
      TEST_ACTOR,
    );
    expect(ok.customFields).toEqual({ risk_level: 'high' });

    await expect(
      t.repos.projects.create(
        { areaId, name: 'Bad', customFields: { risk_level: 'catastrophic' } },
        TEST_ACTOR,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('enforces required fields', async () => {
    await defineField({ key: 'owner_note', kind: 'text', required: true, options: undefined });
    await expect(
      t.repos.projects.create({ areaId, name: 'No note' }, TEST_ACTOR),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('keeps currency values as integer minor units', async () => {
    await defineField({
      key: 'contract_value',
      kind: 'currency',
      currency: 'INR',
      options: undefined,
    });

    await expect(
      t.repos.projects.create(
        { areaId, name: 'Float money', customFields: { contract_value: 1500.5 } },
        TEST_ACTOR,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    const ok = await t.repos.projects.create(
      { areaId, name: 'Paise', customFields: { contract_value: 150_050 } },
      TEST_ACTOR,
    );
    expect(ok.customFields).toEqual({ contract_value: 150_050 });
  });

  it('strips unknown keys rather than failing the whole write', async () => {
    await defineField();
    const project = await t.repos.projects.create(
      { areaId, name: 'Leftover', customFields: { risk_level: 'low', gone: 'x' } },
      TEST_ACTOR,
    );
    expect(project.customFields).toEqual({ risk_level: 'low' });
  });

  it('picks up a new definition immediately', async () => {
    // Warm the compiled-schema cache before the definition exists.
    await t.repos.projects.create({ areaId, name: 'First' }, TEST_ACTOR);
    await defineField();

    const after = await t.repos.projects.create(
      { areaId, name: 'Second', customFields: { risk_level: 'high' } },
      TEST_ACTOR,
    );
    expect(after.customFields).toEqual({ risk_level: 'high' });
  });
});

describe('retiring a field', () => {
  it('hides the field without destroying data already written', async () => {
    const def = await defineField();
    const project = await t.repos.projects.create(
      { areaId, name: 'Has a value', customFields: { risk_level: 'high' } },
      TEST_ACTOR,
    );

    const { archivedUnder } = await t.repos.customFieldDefs.retire(def.id, TEST_ACTOR);
    expect(archivedUnder).toBe('__archived.risk_level');

    // The definition is gone from the active set...
    expect(await t.repos.customFieldDefs.listFor('project')).toHaveLength(0);
    // ...but the stored value is untouched on disk.
    const stored = await t.repos.projects.getById(project.id);
    expect(stored.customFields).toEqual({ risk_level: 'high' });
  });
});
