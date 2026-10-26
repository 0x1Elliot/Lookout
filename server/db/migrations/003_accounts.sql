CREATE TABLE lookout.auth_accounts (
  id text PRIMARY KEY, provider text NOT NULL CHECK(provider IN ('local-dev','supabase')),
  subject text NOT NULL, email text NOT NULL, password_digest text,
  tenant_id text NOT NULL, principal_id text NOT NULL,
  UNIQUE(provider,subject), UNIQUE(provider,email),
  FOREIGN KEY(tenant_id,principal_id) REFERENCES lookout.principals(tenant_id,id)
);
CREATE TABLE lookout.sessions (
  token_hash text PRIMARY KEY CHECK(length(token_hash)=64), account_id text NOT NULL REFERENCES lookout.auth_accounts(id),
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE lookout.invitations (
  email text PRIMARY KEY, tenant_id text NOT NULL REFERENCES lookout.tenants(id),
  role text NOT NULL CHECK(role IN ('worker','reviewer')), invited_by text NOT NULL,
  FOREIGN KEY(tenant_id,invited_by) REFERENCES lookout.principals(tenant_id,id)
);
REVOKE ALL ON lookout.auth_accounts, lookout.sessions, lookout.invitations FROM PUBLIC;
-- Auth tables are accessed only through narrowly scoped, fixed-search-path functions.
CREATE FUNCTION lookout.register_account(p_provider text,p_subject text,p_email text,p_name text,p_digest text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE account text; tenant text; assigned_role text; BEGIN
  IF p_provider NOT IN ('local-dev','supabase') OR length(p_email)>254 OR length(p_name) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Invalid account'; END IF;
  -- Serialize first login/signup for a provider identity, including invitation consumption.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_provider || ':' || p_email,0));
  SELECT a.id INTO account FROM lookout.auth_accounts a WHERE a.provider=p_provider AND a.subject=p_subject;
  IF account IS NOT NULL THEN RETURN account; END IF;
  SELECT i.tenant_id,i.role INTO tenant,assigned_role FROM lookout.invitations i WHERE i.email=p_email FOR UPDATE;
  account:=gen_random_uuid()::text;
  IF tenant IS NULL THEN
    tenant:=gen_random_uuid()::text; assigned_role:='admin';
    INSERT INTO lookout.tenants(id) VALUES(tenant);
    PERFORM set_config('lookout.tenant_id',tenant,true);
    INSERT INTO lookout.inventory(tenant_id,document) VALUES(tenant,'{"schemaVersion":2,"inventoryItems":[],"locations":[],"restockTasks":[],"activity":[]}'::jsonb);
  END IF;
  PERFORM set_config('lookout.tenant_id',tenant,true);
  INSERT INTO lookout.principals(tenant_id,id,name,role,token_hash,expires_at)
    VALUES(tenant,account,p_name,assigned_role,encode(sha256(gen_random_uuid()::text::bytea),'hex'),'infinity');
  INSERT INTO lookout.auth_accounts(id,provider,subject,email,password_digest,tenant_id,principal_id)
    VALUES(account,p_provider,p_subject,p_email,p_digest,tenant,account);
  DELETE FROM lookout.invitations WHERE email=p_email;
  INSERT INTO lookout.audit(tenant_id,id,actor_id,request_id,operation,document)
    VALUES(tenant,gen_random_uuid()::text,account,gen_random_uuid()::text,'auth.signup',jsonb_build_object('provider',p_provider));
  RETURN account;
END $$;
CREATE FUNCTION lookout.local_account(p_email text) RETURNS TABLE(id text,password_digest text)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT a.id,a.password_digest FROM lookout.auth_accounts a WHERE a.provider='local-dev' AND a.email=p_email
$$;
CREATE FUNCTION lookout.start_session(p_account text,p_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE account lookout.auth_accounts; BEGIN
  SELECT a.* INTO STRICT account FROM lookout.auth_accounts a JOIN lookout.principals p ON (p.tenant_id,p.id)=(a.tenant_id,a.principal_id)
    WHERE a.id=p_account AND NOT p.disabled AND p.expires_at>now();
  INSERT INTO lookout.sessions(token_hash,account_id,expires_at) VALUES(p_hash,p_account,now()+interval '8 hours');
  PERFORM set_config('lookout.tenant_id',account.tenant_id,true);
  INSERT INTO lookout.audit(tenant_id,id,actor_id,request_id,operation,document)
    VALUES(account.tenant_id,gen_random_uuid()::text,account.principal_id,gen_random_uuid()::text,'auth.login','{}');
END $$;
CREATE FUNCTION lookout.session_principal(p_hash text) RETURNS TABLE(tenant_id text,id text,name text,role text)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT p.tenant_id,p.id,p.name,p.role FROM lookout.sessions s JOIN lookout.auth_accounts a ON a.id=s.account_id
    JOIN lookout.principals p ON (p.tenant_id,p.id)=(a.tenant_id,a.principal_id)
    WHERE s.token_hash=p_hash AND s.expires_at>now() AND NOT p.disabled AND p.expires_at>now()
$$;
CREATE FUNCTION lookout.end_session(p_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor record; BEGIN
  SELECT * INTO actor FROM lookout.session_principal(p_hash);
  DELETE FROM lookout.sessions WHERE token_hash=p_hash;
  IF actor.id IS NOT NULL THEN
    PERFORM set_config('lookout.tenant_id',actor.tenant_id,true);
    INSERT INTO lookout.audit(tenant_id,id,actor_id,request_id,operation,document)
      VALUES(actor.tenant_id,gen_random_uuid()::text,actor.id,gen_random_uuid()::text,'auth.logout','{}');
  END IF;
END $$;
CREATE FUNCTION lookout.invite_member(p_hash text,p_email text,p_role text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor record; BEGIN
  SELECT * INTO actor FROM lookout.session_principal(p_hash);
  IF actor.role IS DISTINCT FROM 'admin' OR p_role NOT IN ('worker','reviewer') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF EXISTS(SELECT 1 FROM lookout.auth_accounts WHERE email=p_email) THEN RAISE EXCEPTION 'Account already has a workspace'; END IF;
  INSERT INTO lookout.invitations(email,tenant_id,role,invited_by) VALUES(p_email,actor.tenant_id,p_role,actor.id);
  PERFORM set_config('lookout.tenant_id',actor.tenant_id,true);
  INSERT INTO lookout.audit(tenant_id,id,actor_id,request_id,operation,document)
    VALUES(actor.tenant_id,gen_random_uuid()::text,actor.id,gen_random_uuid()::text,'team.invite',jsonb_build_object('email',p_email,'role',p_role));
END $$;
REVOKE ALL ON FUNCTION lookout.register_account(text,text,text,text,text), lookout.local_account(text), lookout.start_session(text,text),
  lookout.session_principal(text), lookout.end_session(text), lookout.invite_member(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lookout.register_account(text,text,text,text,text), lookout.local_account(text), lookout.start_session(text,text),
  lookout.session_principal(text), lookout.end_session(text), lookout.invite_member(text,text,text) TO lookout_runtime;
