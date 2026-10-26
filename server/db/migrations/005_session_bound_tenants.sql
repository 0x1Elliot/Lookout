-- Inventory SQL and identity/session issuance use different restricted logins.
-- A compromised inventory connection must not mint a session for another user.
CREATE ROLE lookout_identity NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA lookout TO lookout_identity;
REVOKE SELECT ON lookout.principals FROM lookout_runtime;
REVOKE EXECUTE ON FUNCTION lookout.register_account(text,text,text,text,text), lookout.local_account(text),
  lookout.start_session(text,text), lookout.end_session(text), lookout.invite_member(text,text,text),
  lookout.start_supabase_session(text,text,integer) FROM lookout_runtime;
GRANT EXECUTE ON FUNCTION lookout.register_account(text,text,text,text,text), lookout.local_account(text),
  lookout.start_session(text,text), lookout.end_session(text), lookout.invite_member(text,text,text),
  lookout.start_supabase_session(text,text,integer) TO lookout_identity;
-- The function resolves a live, non-disabled identity from a session digest.
-- No table access or caller-selected tenant identifier can substitute for it.
CREATE FUNCTION lookout.current_session_tenant() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT tenant_id FROM lookout.session_principal(nullif(current_setting('lookout.session_hash',true),''))
$$;
REVOKE ALL ON FUNCTION lookout.current_session_tenant() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lookout.current_session_tenant() TO lookout_runtime;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['inventory','locations','items','events','cases','reviews','actions','requests','audit'] LOOP
    EXECUTE format('DROP POLICY tenant_scope ON lookout.%I',t);
    EXECUTE format('CREATE POLICY tenant_scope ON lookout.%I USING (tenant_id = (SELECT lookout.current_session_tenant())) WITH CHECK (tenant_id = (SELECT lookout.current_session_tenant()))',t);
  END LOOP;
END $$;
