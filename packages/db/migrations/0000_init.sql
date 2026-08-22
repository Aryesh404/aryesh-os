CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`color` text,
	`semantics` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_categories_key` ON `categories` (`scope`,`key`);--> statement-breakpoint
CREATE INDEX `idx_categories_scope` ON `categories` (`scope`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE TABLE `custom_field_defs` (
	`id` text PRIMARY KEY NOT NULL,
	`object_kind` text NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`kind` text NOT NULL,
	`required` integer DEFAULT false NOT NULL,
	`private` integer DEFAULT false NOT NULL,
	`default_value` text,
	`options` text,
	`min` integer,
	`max` integer,
	`currency` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_cfd_key` ON `custom_field_defs` (`object_kind`,`key`);--> statement-breakpoint
CREATE INDEX `idx_cfd_object` ON `custom_field_defs` (`object_kind`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE TABLE `goals` (
	`id` text PRIMARY KEY NOT NULL,
	`area_id` text NOT NULL,
	`theme_id` text,
	`parent_goal_id` text,
	`name` text NOT NULL,
	`description` text,
	`why` text,
	`start_date` integer,
	`target_date` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`importance` integer DEFAULT 3 NOT NULL,
	`measurement_mode` text DEFAULT 'completion' NOT NULL,
	`progress_model` text DEFAULT '{"mode":"rollup"}' NOT NULL,
	`projection_model` text,
	`progress` real,
	`confidence` real,
	`progress_computed_at` integer,
	`degraded_reason` text,
	`custom_fields` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`theme_id`) REFERENCES `themes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_goals_area` ON `goals` (`area_id`,`status`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX `idx_goals_theme` ON `goals` (`theme_id`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX `idx_goals_parent` ON `goals` (`parent_goal_id`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX `idx_goals_target` ON `goals` (`target_date`) WHERE deleted_at IS NULL AND target_date IS NOT NULL;--> statement-breakpoint
CREATE TABLE `milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_id` text NOT NULL,
	`name` text NOT NULL,
	`due_date` integer,
	`achieved` integer DEFAULT false NOT NULL,
	`achieved_at` integer,
	`weight` real DEFAULT 1 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`custom_fields` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_milestones_goal` ON `milestones` (`goal_id`,`sort_order`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE TABLE `metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`area_id` text,
	`unit` text NOT NULL,
	`direction` text NOT NULL,
	`baseline` real,
	`target` real,
	`target_date` integer,
	`tolerance` real,
	`cadence` text NOT NULL,
	`aggregation` text DEFAULT 'last' NOT NULL,
	`source` text NOT NULL,
	`expression` text,
	`collector_key` text,
	`components` text,
	`bounded` integer DEFAULT true NOT NULL,
	`private` integer DEFAULT false NOT NULL,
	`last_reading_at` integer,
	`last_value` real,
	`custom_fields` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_metrics_key` ON `metrics` (`key`);--> statement-breakpoint
CREATE INDEX `idx_metrics_area` ON `metrics` (`area_id`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX `idx_metrics_stale` ON `metrics` (`last_reading_at`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE TABLE `readings` (
	`id` text PRIMARY KEY NOT NULL,
	`metric_id` text NOT NULL,
	`at` integer NOT NULL,
	`value` real NOT NULL,
	`component` text DEFAULT '' NOT NULL,
	`source` text NOT NULL,
	`note` text,
	`actor` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`metric_id`) REFERENCES `metrics`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_readings_metric_at` ON `readings` (`metric_id`,`at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_readings_dedupe` ON `readings` (`metric_id`,`at`,`source`,`component`);--> statement-breakpoint
CREATE TABLE `relations` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`from_type` text NOT NULL,
	`from_id` text NOT NULL,
	`to_type` text NOT NULL,
	`to_id` text NOT NULL,
	`weight` real,
	`leads_metric_id` text,
	`lag_days` integer,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_relations_unique` ON `relations` (`kind`,`from_type`,`from_id`,`to_type`,`to_id`);--> statement-breakpoint
CREATE INDEX `idx_rel_from` ON `relations` (`from_type`,`from_id`,`kind`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX `idx_rel_to` ON `relations` (`to_type`,`to_id`,`kind`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX `idx_rel_contrib` ON `relations` (`to_id`,`weight`) WHERE kind = 'contributes_to' AND deleted_at IS NULL;--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `areas` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`icon` text,
	`target_share` real,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`custom_fields` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_areas_order` ON `areas` (`sort_order`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE TABLE `themes` (
	`id` text PRIMARY KEY NOT NULL,
	`area_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`why` text,
	`status` text DEFAULT 'active' NOT NULL,
	`target_date` integer,
	`importance` integer DEFAULT 3 NOT NULL,
	`progress` real,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`custom_fields` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_themes_area` ON `themes` (`area_id`,`status`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`before` text,
	`after` text,
	`note` text,
	`execution_id` text
);
--> statement-breakpoint
CREATE INDEX `idx_audit_subject` ON `audit_events` (`subject_type`,`subject_id`,`at`);--> statement-breakpoint
CREATE INDEX `idx_audit_at` ON `audit_events` (`at`);--> statement-breakpoint
CREATE INDEX `idx_audit_actor` ON `audit_events` (`actor`,`at`);--> statement-breakpoint
CREATE TABLE `revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`version` integer NOT NULL,
	`patch` text NOT NULL,
	`inverse` text NOT NULL,
	`actor` text NOT NULL,
	`at` integer NOT NULL,
	`label` text
);
--> statement-breakpoint
CREATE INDEX `idx_revisions_subject` ON `revisions` (`subject_type`,`subject_id`,`version`);--> statement-breakpoint
CREATE TABLE `habit_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`habit_id` text NOT NULL,
	`date` integer NOT NULL,
	`completed` integer NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`habit_id`) REFERENCES `habits`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_habit_entries_unique` ON `habit_entries` (`habit_id`,`date`);--> statement-breakpoint
CREATE TABLE `habits` (
	`id` text PRIMARY KEY NOT NULL,
	`area_id` text,
	`name` text NOT NULL,
	`cadence` text NOT NULL,
	`target_per_period` integer DEFAULT 1 NOT NULL,
	`current_streak` integer DEFAULT 0 NOT NULL,
	`longest_streak` integer DEFAULT 0 NOT NULL,
	`custom_fields` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_habits_area` ON `habits` (`area_id`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`area_id` text,
	`name` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'active' NOT NULL,
	`health` text,
	`start_date` integer,
	`target_date` integer,
	`completed_at` integer,
	`progress` real,
	`progress_basis` text DEFAULT '{"mode":"task_based"}' NOT NULL,
	`progress_confidence` real,
	`local_path` text,
	`repo_url` text,
	`tech_stack` text,
	`custom_fields` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_projects_area` ON `projects` (`area_id`,`status`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX `idx_projects_status` ON `projects` (`status`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`area_id` text,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'todo' NOT NULL,
	`estimate` real,
	`actual` real,
	`due_date` integer,
	`started_at` integer,
	`completed_at` integer,
	`custom_fields` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_project` ON `tasks` (`project_id`,`status`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX `idx_tasks_status` ON `tasks` (`status`,`due_date`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX `idx_tasks_completed` ON `tasks` (`completed_at`) WHERE deleted_at IS NULL;