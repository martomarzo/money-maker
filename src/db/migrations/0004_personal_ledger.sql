CREATE TABLE "transaction_share_splits" (
	"share_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"share_cents" bigint NOT NULL,
	CONSTRAINT "transaction_share_splits_share_id_user_id_pk" PRIMARY KEY("share_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "transaction_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"shared_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_seq" bigint
);
--> statement-breakpoint
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_household_id_households_id_fk";
--> statement-breakpoint
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_owner_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "budgets" DROP CONSTRAINT "budgets_household_id_households_id_fk";
--> statement-breakpoint
ALTER TABLE "categories" DROP CONSTRAINT "categories_household_id_households_id_fk";
--> statement-breakpoint
ALTER TABLE "category_rules" DROP CONSTRAINT "category_rules_household_id_households_id_fk";
--> statement-breakpoint
ALTER TABLE "import_batches" DROP CONSTRAINT "import_batches_household_id_households_id_fk";
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_household_id_households_id_fk";
--> statement-breakpoint
DROP INDEX "accounts_household_idx";--> statement-breakpoint
DROP INDEX "budgets_household_idx";--> statement-breakpoint
DROP INDEX "categories_household_idx";--> statement-breakpoint
DROP INDEX "category_rules_household_idx";--> statement-breakpoint
DROP INDEX "import_batches_household_idx";--> statement-breakpoint
DROP INDEX "transactions_household_seq_idx";--> statement-breakpoint
DROP INDEX "budgets_unique_idx";--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Data migration: every household-owned row moves to the personal ledger of
-- that household's single member. Aborts loudly if any household that owns
-- data has zero or several members (see docs/superpowers/specs/
-- 2026-08-25-personal-ledger-and-households.md §3).
-- ---------------------------------------------------------------------------
ALTER TABLE "accounts" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "category_rules" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "base_currency" char(3) DEFAULT 'EUR' NOT NULL;--> statement-breakpoint
DO $$
DECLARE
  bad record;
BEGIN
  FOR bad IN
    SELECT h.id, h.name, (SELECT count(*) FROM memberships m WHERE m.household_id = h.id) AS members
    FROM households h
    WHERE (SELECT count(*) FROM memberships m WHERE m.household_id = h.id) <> 1
      AND (
        EXISTS (SELECT 1 FROM accounts a WHERE a.household_id = h.id) OR
        EXISTS (SELECT 1 FROM transactions t WHERE t.household_id = h.id) OR
        EXISTS (SELECT 1 FROM categories c WHERE c.household_id = h.id) OR
        EXISTS (SELECT 1 FROM category_rules r WHERE r.household_id = h.id) OR
        EXISTS (SELECT 1 FROM budgets b WHERE b.household_id = h.id) OR
        EXISTS (SELECT 1 FROM import_batches i WHERE i.household_id = h.id)
      )
  LOOP
    RAISE EXCEPTION 'Migration 0004: household % (%) owns data but has % members; expected exactly 1',
      bad.id, bad.name, bad.members;
  END LOOP;
END $$;--> statement-breakpoint
UPDATE "accounts" a SET user_id = m.user_id FROM memberships m WHERE m.household_id = a.household_id AND a.user_id IS NULL;--> statement-breakpoint
UPDATE "budgets" b SET user_id = m.user_id FROM memberships m WHERE m.household_id = b.household_id AND b.user_id IS NULL;--> statement-breakpoint
UPDATE "categories" c SET user_id = m.user_id FROM memberships m WHERE m.household_id = c.household_id AND c.user_id IS NULL;--> statement-breakpoint
UPDATE "category_rules" r SET user_id = m.user_id FROM memberships m WHERE m.household_id = r.household_id AND r.user_id IS NULL;--> statement-breakpoint
UPDATE "import_batches" i SET user_id = m.user_id FROM memberships m WHERE m.household_id = i.household_id AND i.user_id IS NULL;--> statement-breakpoint
UPDATE "transactions" t SET user_id = m.user_id FROM memberships m WHERE m.household_id = t.household_id AND t.user_id IS NULL;--> statement-breakpoint
UPDATE "users" u SET base_currency = h.base_currency FROM memberships m JOIN households h ON h.id = m.household_id WHERE m.user_id = u.id;--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "budgets" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "category_rules" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batches" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction_share_splits" ADD CONSTRAINT "transaction_share_splits_share_id_transaction_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."transaction_shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_share_splits" ADD CONSTRAINT "transaction_share_splits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_shares" ADD CONSTRAINT "transaction_shares_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_shares" ADD CONSTRAINT "transaction_shares_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_shares" ADD CONSTRAINT "transaction_shares_shared_by_user_id_users_id_fk" FOREIGN KEY ("shared_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_shares_transaction_idx" ON "transaction_shares" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "transaction_shares_household_idx" ON "transaction_shares" USING btree ("household_id","server_seq");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id","server_seq");--> statement-breakpoint
CREATE INDEX "budgets_user_idx" ON "budgets" USING btree ("user_id","server_seq");--> statement-breakpoint
CREATE INDEX "categories_user_idx" ON "categories" USING btree ("user_id","server_seq");--> statement-breakpoint
CREATE INDEX "category_rules_user_idx" ON "category_rules" USING btree ("user_id","server_seq");--> statement-breakpoint
CREATE INDEX "import_batches_user_idx" ON "import_batches" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "transactions_user_seq_idx" ON "transactions" USING btree ("user_id","server_seq");--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_unique_idx" ON "budgets" USING btree ("user_id","category_id","month");--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN "household_id";--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN "owner_user_id";--> statement-breakpoint
ALTER TABLE "budgets" DROP COLUMN "household_id";--> statement-breakpoint
ALTER TABLE "categories" DROP COLUMN "household_id";--> statement-breakpoint
ALTER TABLE "category_rules" DROP COLUMN "household_id";--> statement-breakpoint
ALTER TABLE "import_batches" DROP COLUMN "household_id";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "household_id";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "visibility";--> statement-breakpoint
DROP TYPE "public"."visibility";--> statement-breakpoint
CREATE TRIGGER transaction_shares_server_seq BEFORE INSERT OR UPDATE ON "transaction_shares"
  FOR EACH ROW EXECUTE FUNCTION set_server_seq();
