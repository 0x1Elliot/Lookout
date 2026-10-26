-- A group role only: provision its LOGIN member separately with a generated secret.
CREATE ROLE lookout_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA lookout TO lookout_runtime;
GRANT SELECT ON lookout.principals TO lookout_runtime;
GRANT SELECT, UPDATE ON lookout.inventory TO lookout_runtime;
GRANT SELECT, INSERT ON lookout.locations, lookout.events, lookout.reviews, lookout.actions, lookout.requests, lookout.audit TO lookout_runtime;
GRANT SELECT, INSERT, UPDATE ON lookout.items, lookout.cases TO lookout_runtime;
-- Runtime cannot provision identities, delete records, change schema, or rewrite audit/history.
