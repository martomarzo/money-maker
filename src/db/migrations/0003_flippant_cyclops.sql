CREATE TYPE "public"."wallet_capture_status" AS ENUM('booked', 'needs_account', 'unparsed', 'dismissed');--> statement-breakpoint
CREATE TABLE "wallet_captures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"raw" jsonb NOT NULL,
	"capture_hash" text NOT NULL,
	"status" "wallet_capture_status" NOT NULL,
	"amount_minor" bigint,
	"currency" char(3),
	"merchant" text,
	"card_key" text,
	"transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_captures_capture_hash_unique" UNIQUE("capture_hash")
);
--> statement-breakpoint
CREATE TABLE "wallet_card_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"card_key" text NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "wallet_devices_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "wallet_captures" ADD CONSTRAINT "wallet_captures_device_id_wallet_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."wallet_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_captures" ADD CONSTRAINT "wallet_captures_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_card_mappings" ADD CONSTRAINT "wallet_card_mappings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_card_mappings" ADD CONSTRAINT "wallet_card_mappings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_devices" ADD CONSTRAINT "wallet_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wallet_captures_device_idx" ON "wallet_captures" USING btree ("device_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_card_mappings_user_key_idx" ON "wallet_card_mappings" USING btree ("user_id","card_key");