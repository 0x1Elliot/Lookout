-- Provider credentials never enter this database. Bound the opaque local session
-- to the lifetime returned by the verified Auth token endpoint (max eight hours).
CREATE FUNCTION lookout.start_supabase_session(p_account text,p_hash text,p_seconds integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF p_seconds IS NULL OR p_seconds NOT BETWEEN 1 AND 28800
    OR NOT EXISTS (SELECT 1 FROM lookout.auth_accounts WHERE id=p_account AND provider='supabase') THEN
    RAISE EXCEPTION 'Invalid provider session';
  END IF;
  PERFORM lookout.start_session(p_account,p_hash);
  UPDATE lookout.sessions SET expires_at=now()+make_interval(secs=>p_seconds) WHERE token_hash=p_hash;
END $$;
REVOKE ALL ON FUNCTION lookout.start_supabase_session(text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lookout.start_supabase_session(text,text,integer) TO lookout_runtime;
