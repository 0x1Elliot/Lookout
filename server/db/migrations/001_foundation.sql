CREATE SCHEMA lookout;
REVOKE ALL ON SCHEMA lookout FROM PUBLIC;
CREATE TABLE lookout.tenants (id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200));
CREATE TABLE lookout.principals (
  tenant_id text NOT NULL REFERENCES lookout.tenants(id),
  id text NOT NULL, name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  role text NOT NULL CHECK (role IN ('worker','reviewer','admin')),
  token_hash text NOT NULL UNIQUE CHECK (length(token_hash)=64),
  expires_at timestamptz NOT NULL, disabled boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id,id)
);
CREATE TABLE lookout.inventory (
  tenant_id text PRIMARY KEY REFERENCES lookout.tenants(id),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  document jsonb NOT NULL CHECK (jsonb_typeof(document)='object')
);
CREATE TABLE lookout.locations (
  tenant_id text NOT NULL REFERENCES lookout.tenants(id), id text NOT NULL,
  name text NOT NULL, PRIMARY KEY(tenant_id,id)
);
CREATE TABLE lookout.items (
  tenant_id text NOT NULL, id text NOT NULL, location_id text NOT NULL, name text NOT NULL,
  quantity bigint NOT NULL CHECK (quantity BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,location_id) REFERENCES lookout.locations(tenant_id,id)
);
CREATE TABLE lookout.events (
  tenant_id text NOT NULL REFERENCES lookout.tenants(id), id text NOT NULL, item_id text,
  document jsonb NOT NULL, PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,item_id) REFERENCES lookout.items(tenant_id,id)
);
CREATE TABLE lookout.cases (
  tenant_id text NOT NULL, id text NOT NULL, event_id text NOT NULL, document jsonb NOT NULL,
  PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,event_id) REFERENCES lookout.events(tenant_id,id)
);
CREATE TABLE lookout.reviews (
  tenant_id text NOT NULL, id text NOT NULL, case_id text NOT NULL, reviewer_id text NOT NULL,
  document jsonb NOT NULL, PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,case_id) REFERENCES lookout.cases(tenant_id,id),
  FOREIGN KEY(tenant_id,reviewer_id) REFERENCES lookout.principals(tenant_id,id)
);
CREATE TABLE lookout.actions (
  tenant_id text NOT NULL, id text NOT NULL, case_id text NOT NULL, item_id text NOT NULL,
  document jsonb NOT NULL, PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,case_id),
  FOREIGN KEY(tenant_id,case_id) REFERENCES lookout.cases(tenant_id,id),
  FOREIGN KEY(tenant_id,item_id) REFERENCES lookout.items(tenant_id,id)
);
CREATE TABLE lookout.requests (
  tenant_id text NOT NULL, actor_id text NOT NULL, id text NOT NULL, fingerprint text NOT NULL,
  response jsonb NOT NULL, PRIMARY KEY(tenant_id,actor_id,id),
  FOREIGN KEY(tenant_id,actor_id) REFERENCES lookout.principals(tenant_id,id)
);
CREATE TABLE lookout.audit (
  tenant_id text NOT NULL, id text NOT NULL, actor_id text NOT NULL, request_id text NOT NULL,
  operation text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), document jsonb NOT NULL,
  PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,actor_id) REFERENCES lookout.principals(tenant_id,id)
);
-- Every data table is scoped to the authenticated tenant, even if a query omits its filter.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['inventory','locations','items','events','cases','reviews','actions','requests','audit'] LOOP
    EXECUTE format('ALTER TABLE lookout.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE lookout.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_scope ON lookout.%I USING (tenant_id = current_setting(''lookout.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''lookout.tenant_id'', true))', t);
  END LOOP;
END $$;
