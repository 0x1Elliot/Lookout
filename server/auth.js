import { randomBytes, scrypt as rawScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { fail, tokenHash } from './security.js';
const scrypt = promisify(rawScrypt);
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
export function authConfig(env = process.env) {
  const provider = env.LOOKOUT_AUTH ?? 'supabase';
  if (!['supabase','local-dev'].includes(provider)) throw new Error('LOOKOUT_AUTH must be supabase or local-dev.');
  if (provider === 'local-dev') {
    if (env.NODE_ENV === 'production' || !['localhost','127.0.0.1','[::1]'].includes(new URL(env.DATABASE_URL).hostname)) throw new Error('Local development auth requires a local database and is forbidden in production.');
    const origin = env.APP_ORIGIN ?? 'http://127.0.0.1:4173';
    const localOrigin = new URL(origin);
    if (!['localhost','127.0.0.1','[::1]'].includes(localOrigin.hostname) || localOrigin.origin !== origin) throw new Error('Local development auth requires a loopback APP_ORIGIN.');
    return { provider, origin, secure: false };
  }
  let url, origin;
  try { url = new URL(env.SUPABASE_URL); origin = new URL(env.APP_ORIGIN); } catch { throw new Error('SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and APP_ORIGIN are required.'); }
  if (url.protocol !== 'https:' || origin.protocol !== 'https:' || origin.origin !== env.APP_ORIGIN || url.origin !== env.SUPABASE_URL) throw new Error('Production auth requires HTTPS origin URLs.');
  const key = env.SUPABASE_PUBLISHABLE_KEY ?? '';
  let anon = false;
  try { anon = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon'; } catch { /* New publishable keys are opaque. */ }
  if (!key.startsWith('sb_publishable_') && !anon) throw new Error('Use a Supabase publishable/anon key, never a secret key.');
  return { provider, origin: origin.origin, secure: true, url: url.origin, key: env.SUPABASE_PUBLISHABLE_KEY };
}
export function sessionHash(headers, secure = false) {
  const prefix = secure ? '__Host-lookout_session=' : 'lookout_session=';
  const cookie = headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(prefix));
  const token = cookie?.slice(prefix.length);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw fail(401, 'Sign in required.');
  return tokenHash(token);
}
export const sessionCookie = (token, secure, logout = false) => `${secure ? '__Host-lookout_session' : 'lookout_session'}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${logout ? 0 : 28800}${secure ? '; Secure' : ''}`;
export function validateLogin(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail(400,'Invalid sign-in request.');
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400,'Enter a valid email address.');
  if (typeof input.password !== 'string' || input.password.length < 12 || input.password.length > 128) throw fail(400,'Use a password between 12 and 128 characters.');
  return { email, password: input.password };
}
export class AccountAuth {
  constructor(pool, config, fetcher = fetch) { this.pool=pool; this.config=config; this.fetch=fetcher; this.attempts=new Map(); this.inflight=0; }
  limit(address) {
    const now=Date.now();
    for (const [key,entry] of this.attempts) if(entry.until<now) this.attempts.delete(key);
    const entry=this.attempts.get(address)??{count:0,until:now+60000}; entry.count++; this.attempts.set(address,entry);
    if(entry.count>15 || this.inflight>=4 || this.attempts.size>10000) throw fail(429,'Too many sign-in attempts. Try again shortly.');
  }
  async provider(path, body, accessToken) {
    let response;
    try { response=await this.fetch(`${this.config.url}/auth/v1/${path}`, { method:body?'POST':'GET', headers:{apikey:this.config.key,'Content-Type':'application/json',...(accessToken?{Authorization:`Bearer ${accessToken}`}:{})}, ...(body?{body:JSON.stringify(body)}:{}), signal:AbortSignal.timeout(10000) }); }
    catch { throw fail(503,'Sign-in provider is unavailable. Try again later.'); }
    if (!response.ok) {
      const status = response.status === 429 ? 429 : response.status >= 500 ? 503 : 401;
      throw fail(status, status === 503 ? 'Sign-in provider is unavailable. Try again later.' : 'Unable to sign in. Check your email, password and email verification.');
    }
    let value;
    try { value = await response.json(); } catch { throw fail(503, 'Invalid sign-in provider response.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(503, 'Invalid sign-in provider response.');
    return value;
  }
  async verifyProviderSettings() {
    const settings = await this.provider('settings');
    if (settings.external?.email !== true || settings.mailer_autoconfirm !== false) {
      throw fail(503, 'Enable email sign-in and email confirmation in Supabase before using Lookout.');
    }
    return settings;
  }
  async signup(input) {
    const {email,password}=validateLogin(input);
    const name=typeof input.name==='string'?input.name.trim():'';
    if(!name || name.length>200) throw fail(400,'Enter your name (at most 200 characters).');
    if(this.config.provider==='supabase') {
      await this.verifyProviderSettings();
      await this.provider('signup',{email,password});
      return { message:'Check your email to verify your account, then sign in.' };
    }
    const salt=randomBytes(16).toString('hex');
    const digest=`${salt}:${(await scrypt(password,salt,64,options)).toString('hex')}`;
    await this.pool.query('SELECT lookout.register_account($1,$2,$3,$4,$5)', ['local-dev',email,email,name,digest]);
    return {message:'Account ready. Sign in with your email and password. Local development does not verify email ownership.'};
  }
  async login(input) {
    const {email,password}=validateLogin(input);
    let account, deadline;
    if(this.config.provider==='supabase') {
      await this.verifyProviderSettings();
      const started = Date.now();
      const session=await this.provider('token?grant_type=password',{email,password});
      if (typeof session.access_token !== 'string' || !session.access_token.trim()
        || !Number.isSafeInteger(session.expires_in) || session.expires_in < 1) throw fail(503, 'Invalid sign-in provider session.');
      const user=await this.provider('user',undefined,session.access_token);
      if(typeof user.id !== 'string' || !user.id || typeof user.email !== 'string' || user.email.toLowerCase()!==email || !user.email_confirmed_at) throw fail(401,'Verify your email before signing in.');
      deadline = started + Math.min(28800, session.expires_in) * 1000;
      if (deadline <= Date.now()) throw fail(401, 'Sign-in expired. Sign in again.');
      // Provider-verified subject only. User metadata never sets tenant or role.
      const {rows:[result]}=await this.pool.query('SELECT lookout.register_account($1,$2,$3,$4,$5) AS id',['supabase',user.id,email,email.slice(0,200),null]);
      account=result.id;
    } else {
      const {rows:[record]}=await this.pool.query('SELECT * FROM lookout.local_account($1)',[email]);
      const [salt,digest]=record?.password_digest?.split(':')??['0'.repeat(32),'0'.repeat(128)];
      const actual=await scrypt(password,salt,64,options);
      if(!record || !timingSafeEqual(actual,Buffer.from(digest,'hex'))) throw fail(401,'Email or password is incorrect.');
      account=record.id;
    }
    const lifetime = deadline === undefined ? 28800 : Math.floor((deadline - Date.now()) / 1000);
    if (lifetime < 1) throw fail(401, 'Sign-in expired. Sign in again.');
    const token=randomBytes(32).toString('base64url');
    try {
      if (this.config.provider === 'supabase') await this.pool.query('SELECT lookout.start_supabase_session($1,$2,$3)', [account,tokenHash(token),lifetime]);
      else await this.pool.query('SELECT lookout.start_session($1,$2)',[account,tokenHash(token)]);
    }
    catch (error) { if(error.code==='P0002') throw fail(401,'This account is unavailable.'); throw error; }
    return token;
  }
  async logout(hash) { await this.pool.query('SELECT lookout.end_session($1)',[hash]); }
  async invite(hash,input) {
    const email=typeof input.email==='string'?input.email.trim().toLowerCase():'';
    if(email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !['worker','reviewer'].includes(input.role)) throw fail(400,'Enter a valid email and worker or reviewer role.');
    try { await this.pool.query('SELECT lookout.invite_member($1,$2,$3)',[hash,email,input.role]); }
    catch(error) { if(error.code==='P0001'||error.code==='23505') throw fail(403,'Invitation not allowed. Use a new teammate email and an administrator account.'); throw error; }
    return {message:'Invitation prepared. Ask your teammate to sign up with this email. No email has been sent.'};
  }
}
