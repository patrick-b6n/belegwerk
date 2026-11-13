CREATE TABLE `bookings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`type` text NOT NULL,
	`gross_cents` integer NOT NULL,
	`vat_rate` text,
	`net_cents` integer NOT NULL,
	`vat_cents` integer NOT NULL,
	`category_id` integer NOT NULL,
	`description` text NOT NULL,
	`counterparty` text NOT NULL,
	`reference` text,
	`note` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`external_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "bookings_date_check" CHECK(date("date") IS "date" AND "date" >= '1000-01-01'),
	CONSTRAINT "bookings_type_check" CHECK("type" IN ('income', 'expense')),
	CONSTRAINT "bookings_vat_rate_check" CHECK("vat_rate" IN ('0', '7', '19', 'reverse_charge')),
	CONSTRAINT "bookings_source_check" CHECK("source" IN ('manual', 'stripe')),
	CONSTRAINT "bookings_gross_cents_check" CHECK("gross_cents" > 0),
	CONSTRAINT "bookings_net_cents_check" CHECK("net_cents" >= 0),
	CONSTRAINT "bookings_vat_cents_check" CHECK("vat_cents" >= 0),
	CONSTRAINT "bookings_amounts_check" CHECK("net_cents" + "vat_cents" = "gross_cents"),
	CONSTRAINT "bookings_no_vat_rate_check" CHECK("vat_rate" IS NOT NULL OR "vat_cents" = 0)
);
--> statement-breakpoint
CREATE INDEX `bookings_date_idx` ON `bookings` (`date`);--> statement-breakpoint
CREATE INDEX `bookings_category_id_idx` ON `bookings` (`category_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `bookings_source_external_id_unique` ON `bookings` (`source`,`external_id`) WHERE "external_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`euer_position` text NOT NULL,
	`reduces_income` integer DEFAULT false NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	CONSTRAINT "categories_type_check" CHECK("type" IN ('income', 'expense')),
	CONSTRAINT "categories_reduces_income_check" CHECK("reduces_income" IN (0, 1)),
	CONSTRAINT "categories_archived_check" CHECK("archived" IN (0, 1)),
	CONSTRAINT "categories_is_system_check" CHECK("is_system" IN (0, 1)),
	CONSTRAINT "categories_reduces_income_expense_check" CHECK("reduces_income" = 0 OR "type" = 'expense')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_type_name_unique` ON `categories` (`type`,`name`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tax_years` (
	`year` integer PRIMARY KEY NOT NULL,
	`small_business` integer DEFAULT false NOT NULL,
	CONSTRAINT "tax_years_year_check" CHECK("year" BETWEEN 1000 AND 9999),
	CONSTRAINT "tax_years_small_business_check" CHECK("small_business" IN (0, 1))
);
