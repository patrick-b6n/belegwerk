-- Booking days become UTC timestamps: 00:00 in Europe/Berlin. SQLite has no
-- time zones, so the EU summer time rule (last Sunday in March to last Sunday
-- in October, since 1996) is written out; at 00:00 of the switch days the old
-- offset still applies. Earlier years get 12:00 UTC, which is the same day in
-- Berlin whatever the offset was.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_bookings` (
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
	CONSTRAINT "bookings_date_check" CHECK(strftime('%Y-%m-%dT%H:%M:%fZ', "date") IS "date" AND "date" >= '0999-12-31'),
	CONSTRAINT "bookings_type_check" CHECK("type" IN ('income', 'expense')),
	CONSTRAINT "bookings_vat_rate_check" CHECK("vat_rate" IN ('0', '7', '19', 'reverse_charge')),
	CONSTRAINT "bookings_source_check" CHECK("source" IN ('manual', 'stripe')),
	CONSTRAINT "bookings_external_id_check" CHECK("external_id" IS NULL OR "external_id" <> ''),
	CONSTRAINT "bookings_gross_cents_check" CHECK(typeof("gross_cents") = 'integer' AND "gross_cents" > 0),
	CONSTRAINT "bookings_net_cents_check" CHECK(typeof("net_cents") = 'integer' AND "net_cents" >= 0),
	CONSTRAINT "bookings_vat_cents_check" CHECK(typeof("vat_cents") = 'integer' AND "vat_cents" >= 0),
	CONSTRAINT "bookings_amounts_check" CHECK("net_cents" + "vat_cents" = "gross_cents"),
	CONSTRAINT "bookings_vat_cents_rate_check" CHECK("vat_cents" = 0 OR coalesce("vat_rate", '') IN ('7', '19'))
);
--> statement-breakpoint
INSERT INTO `__new_bookings`("id", "date", "type", "gross_cents", "vat_rate", "net_cents", "vat_cents", "category_id", "description", "counterparty", "reference", "note", "source", "external_id", "created_at", "updated_at") SELECT "id", CASE
    WHEN "date" < '1996-01-01' THEN "date" || 'T12:00:00.000Z'
    WHEN "date" > date(substr("date", 1, 4) || '-04-01', 'weekday 0', '-7 days')
      AND "date" <= date(substr("date", 1, 4) || '-11-01', 'weekday 0', '-7 days')
      THEN date("date", '-1 day') || 'T22:00:00.000Z'
    ELSE date("date", '-1 day') || 'T23:00:00.000Z'
  END, "type", "gross_cents", "vat_rate", "net_cents", "vat_cents", "category_id", "description", "counterparty", "reference", "note", "source", "external_id", "created_at", "updated_at" FROM `bookings`;--> statement-breakpoint
-- IDs of deleted bookings must not be reused after the rebuild.
DELETE FROM sqlite_sequence WHERE name = '__new_bookings';--> statement-breakpoint
INSERT INTO sqlite_sequence (name, seq) SELECT '__new_bookings', seq FROM sqlite_sequence WHERE name = 'bookings';--> statement-breakpoint
DROP TABLE `bookings`;--> statement-breakpoint
ALTER TABLE `__new_bookings` RENAME TO `bookings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `bookings_date_idx` ON `bookings` (`date`);--> statement-breakpoint
CREATE INDEX `bookings_category_id_idx` ON `bookings` (`category_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `bookings_source_external_id_unique` ON `bookings` (`source`,`external_id`) WHERE "external_id" IS NOT NULL;--> statement-breakpoint
UPDATE `settings` SET "value" = CASE
    WHEN "value" < '1996-01-01' THEN "value" || 'T12:00:00.000Z'
    WHEN "value" > date(substr("value", 1, 4) || '-04-01', 'weekday 0', '-7 days')
      AND "value" <= date(substr("value", 1, 4) || '-11-01', 'weekday 0', '-7 days')
      THEN date("value", '-1 day') || 'T22:00:00.000Z'
    ELSE date("value", '-1 day') || 'T23:00:00.000Z'
  END
WHERE "key" = 'stripe.lastImportTo' AND date("value") IS "value";
