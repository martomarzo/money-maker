-- Global monotonic sequence powering per-row server_seq on all sync-tracked
-- tables. Globally monotonic implies per-household monotonic, which is all
-- /api/sync/pull needs. A trigger stamps it on every INSERT and UPDATE so
-- application code can never forget.

CREATE SEQUENCE IF NOT EXISTS sync_server_seq;

CREATE OR REPLACE FUNCTION set_server_seq() RETURNS trigger AS $$
BEGIN
  NEW.server_seq := nextval('sync_server_seq');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER accounts_server_seq BEFORE INSERT OR UPDATE ON "accounts"
  FOR EACH ROW EXECUTE FUNCTION set_server_seq();

CREATE TRIGGER categories_server_seq BEFORE INSERT OR UPDATE ON "categories"
  FOR EACH ROW EXECUTE FUNCTION set_server_seq();

CREATE TRIGGER transactions_server_seq BEFORE INSERT OR UPDATE ON "transactions"
  FOR EACH ROW EXECUTE FUNCTION set_server_seq();

CREATE TRIGGER budgets_server_seq BEFORE INSERT OR UPDATE ON "budgets"
  FOR EACH ROW EXECUTE FUNCTION set_server_seq();
