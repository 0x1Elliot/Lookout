import test from 'node:test';import assert from 'node:assert/strict';
import {createApplication} from './application.js';
const base={LOOKOUT_MODE:'secure',LOOKOUT_AUTH:'supabase',DATABASE_URL:'postgresql://runtime@127.0.0.1/test',SUPABASE_URL:'https://project.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',APP_ORIGIN:'https://app.example'};
test('missing identity connection fails before database access even if administrator URL exists',async()=>{
 await assert.rejects(createApplication({...base,MIGRATION_DATABASE_URL:'postgresql://admin@127.0.0.1/test'}),/AUTH_DATABASE_URL is required/);
});
test('application rejects shared runtime/identity login instead of weakening credential separation',async()=>{
 await assert.rejects(createApplication({...base,AUTH_DATABASE_URL:base.DATABASE_URL}),/separate logins/);
});
