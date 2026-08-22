import {
  areas,
  categories,
  habitEntries,
  habits,
  metrics,
  milestones,
  projects,
  tasks,
  themes,
} from '../schema/index.js';
import type { Db } from '../client.js';
import { createRepository, type CustomFieldsGuard, type RepoDeps } from './base.js';
import {
  createCustomFieldDefsRepository,
  createCustomFieldValidator,
} from './custom-fields.js';
import { createGoalsRepository } from './goals.js';
import { createReadingsRepository } from './readings.js';
import { createRelationsRepository } from './relations.js';

export * from './base.js';
export * from './custom-fields.js';
export * from './goals.js';
export * from './readings.js';
export * from './relations.js';

export interface RepositoriesOptions {
  db: Db;
  /** Injected so nothing in the data layer reads the wall clock directly. */
  clock?: () => number;
}

export function createRepositories({ db, clock = Date.now }: RepositoriesOptions) {
  const deps: RepoDeps = { db, clock };
  const customFieldValidator = createCustomFieldValidator(db);

  const guard = (objectKind: string): CustomFieldsGuard => ({
    objectKind,
    validate: customFieldValidator.validate,
  });

  return {
    areas: createRepository(deps, areas, 'area', {
      revisioned: true,
      customFields: guard('area'),
    }),
    themes: createRepository(deps, themes, 'theme', {
      revisioned: true,
      customFields: guard('theme'),
    }),
    goals: createGoalsRepository(deps, guard('goal')),
    milestones: createRepository(deps, milestones, 'milestone', {
      customFields: guard('milestone'),
    }),
    metrics: createRepository(deps, metrics, 'metric', {
      revisioned: true,
      customFields: guard('metric'),
    }),
    readings: createReadingsRepository(deps),
    projects: createRepository(deps, projects, 'project', {
      customFields: guard('project'),
    }),
    tasks: createRepository(deps, tasks, 'task', { customFields: guard('task') }),
    habits: createRepository(deps, habits, 'habit', { customFields: guard('habit') }),
    habitEntries: habitEntries,
    relations: createRelationsRepository(deps),
    categories: createRepository(deps, categories, 'category', { revisioned: true }),
    customFieldDefs: createCustomFieldDefsRepository(deps, customFieldValidator),
    customFieldValidator,
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
