// Authentication: opaque cookie sessions backed by Postgres, plus the OAuth 2.0
// authorization-code flow for Google and Facebook (hand-rolled to keep dependencies minimal).
//
// Security notes:
//  - The session cookie holds a random token; only its SHA-256 is stored server-side.
//  - redirect_uri is built from BASE_URL, never from the Host header.
//  - `state` (CSRF) is checked on the callback, and Google also gets PKCE.
//  - Accounts are NEVER merged by email: an unverified email on one provider could otherwise be
//    used to take over someone else's account. Linking a second provider is an explicit action
//    performed while logged in.
'use strict';
const crypto = require('crypto');
const config = require('./config');
const db = require('./db');
const { HttpError, redirect, readJson, sendJson, parseCookies, serializeCookie, addCookie } = require('./http');

// __Host- prefix (Secure, Path=/, no Domain) is only valid over HTTPS.
const SESSION_COOKIE = config.secureCookies ? '__Host-ar_sid' : 'ar_sid';
const OAUTH_COOKIE = 'ar_oauth';

const sha256hex = (s) => crypto.createHash('sha256').update(s).digest('hex');
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const sessionLifetime = () => `${config.sessionDays} days`;

function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
const cleanAvatar = (s) => (typeof s === 'string' && /^https:\/\//.test(s) && s.length <= 500 ? s : null);

/* ---------- login sessions ---------- */

function sessionCookie(token) {
  return serializeCookie(SESSION_COOKIE, token, { maxAge: config.sessionDays * 86400, secure: config.secureCookies });
}

async function createSession(res, userId) {
  const token = randomToken();
  await db.query('INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + $3::interval)',
    [sha256hex(token), userId, sessionLifetime()]);
  addCookie(res, sessionCookie(token)); // a fresh token on every login also prevents session fixation
}

// Returns the logged-in user (or null). Sessions are sliding: used for at least a day, they are
// extended so an active user is not logged out mid-use.
async function authenticate(req, res) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token || token.length > 200) return null;
  const hash = sha256hex(token);
  const { rows } = await db.query(
    `SELECT u.id, u.name, u.email, u.avatar_url, u.preferences, u.onboarded, s.expires_at
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`, [hash]);
  const row = rows[0];
  if (!row) return null;
  const remainingMs = new Date(row.expires_at).getTime() - Date.now();
  if (remainingMs < (config.sessionDays - 1) * 86400000) {
    await db.query('UPDATE auth_sessions SET expires_at = now() + $2::interval WHERE token_hash = $1', [hash, sessionLifetime()]);
    if (res) addCookie(res, sessionCookie(token));
  }
  return { id: row.id, name: row.name, email: row.email, avatarUrl: row.avatar_url, preferences: row.preferences, onboarded: row.onboarded };
}

async function destroySession(req, res) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) await db.query('DELETE FROM auth_sessions WHERE token_hash = $1', [sha256hex(token)]);
  addCookie(res, serializeCookie(SESSION_COOKIE, '', { maxAge: 0, secure: config.secureCookies }));
}

/* ---------- users ---------- */

async function findOrCreateUser(provider, profile) {
  const attempt = () => db.withTx(async (c) => {
    const found = await c.query('SELECT user_id FROM identities WHERE provider = $1 AND provider_user_id = $2', [provider, profile.id]);
    if (found.rows[0]) {
      const userId = found.rows[0].user_id;
      await c.query('UPDATE users SET last_login_at = now(), avatar_url = COALESCE($2, avatar_url), email = COALESCE(email, $3) WHERE id = $1',
        [userId, profile.avatar, profile.email]);
      await c.query('UPDATE identities SET email = $3, email_verified = $4 WHERE provider = $1 AND provider_user_id = $2',
        [provider, profile.id, profile.email, profile.emailVerified]);
      return userId;
    }
    const created = await c.query('INSERT INTO users (name, email, avatar_url) VALUES ($1, $2, $3) RETURNING id',
      [profile.name, profile.email, profile.avatar]);
    await c.query('INSERT INTO identities (provider, provider_user_id, user_id, email, email_verified) VALUES ($1, $2, $3, $4, $5)',
      [provider, profile.id, created.rows[0].id, profile.email, profile.emailVerified]);
    return created.rows[0].id;
  });
  try { return await attempt(); }
  catch (e) {
    if (e.code !== '23505') throw e;
    return attempt(); // two first-logins raced on the same identity: the second just finds it
  }
}

// Returns false when that provider account already belongs to a different user.
async function linkIdentity(userId, provider, profile) {
  const found = await db.query('SELECT user_id FROM identities WHERE provider = $1 AND provider_user_id = $2', [provider, profile.id]);
  if (found.rows[0]) return found.rows[0].user_id === userId;
  await db.query('INSERT INTO identities (provider, provider_user_id, user_id, email, email_verified) VALUES ($1, $2, $3, $4, $5)',
    [provider, profile.id, userId, profile.email, profile.emailVerified]);
  return true;
}

/* ---------- OAuth ---------- */

const redirectUri = (p) => `${config.baseUrl}/auth/${p.id}/callback`;

async function fetchJson(url, opts) {
  let r;
  try { r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(10000) }, opts)); }
  catch (e) { throw new Error(`rete: ${e.message}`); }
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
  if (!r.ok || !json) throw new Error(`risposta HTTP ${r.status} dal provider`);
  return json;
}

async function exchangeCode(p, code, verifier) {
  const params = new URLSearchParams({ code, redirect_uri: redirectUri(p), client_id: p.clientId, client_secret: p.clientSecret });
  if (p.id === 'facebook') { // Graph API token endpoint: parameters in the query string
    const u = new URL(p.tokenUrl); u.search = params.toString();
    return fetchJson(u, { headers: { accept: 'application/json' } });
  }
  params.set('grant_type', 'authorization_code');
  if (verifier) params.set('code_verifier', verifier);
  return fetchJson(p.tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: params });
}

async function fetchProfile(p, accessToken) {
  let url = p.userinfoUrl;
  if (p.id === 'facebook') { // appsecret_proof binds the token to our app (harmless if not enforced)
    const u = new URL(url);
    u.searchParams.set('appsecret_proof', crypto.createHmac('sha256', p.clientSecret).update(accessToken).digest('hex'));
    url = u.toString();
  }
  const raw = await fetchJson(url, { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' } });
  const profile = p.id === 'google'
    ? { id: raw.sub, name: raw.name || raw.email, email: raw.email, avatar: raw.picture, verified: raw.email_verified === true || raw.email_verified === 'true' }
    : { id: raw.id, name: raw.name, email: raw.email, avatar: raw.picture && raw.picture.data && raw.picture.data.url, verified: false };
  if (typeof profile.id !== 'string' || !profile.id || profile.id.length > 200) throw new Error('profilo senza identificativo');
  return {
    id: profile.id,
    name: cleanName(profile.name) || 'Utente',
    email: typeof profile.email === 'string' && profile.email.length <= 254 ? profile.email : null,
    emailVerified: profile.verified === true,
    avatar: cleanAvatar(profile.avatar),
  };
}

async function startOAuth(req, res, p, url) {
  const link = url.searchParams.get('link') === '1';
  if (link && !(await authenticate(req, res))) return redirect(res, '/?auth_error=login_required');
  const state = randomToken(24);
  const verifier = p.pkce ? randomToken(48) : null;
  const u = new URL(p.authUrl);
  u.searchParams.set('client_id', p.clientId);
  u.searchParams.set('redirect_uri', redirectUri(p));
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', p.scope);
  u.searchParams.set('state', state);
  if (p.id === 'google') u.searchParams.set('prompt', 'select_account'); // let people on shared devices pick the account
  if (verifier) {
    u.searchParams.set('code_challenge', crypto.createHash('sha256').update(verifier).digest('base64url'));
    u.searchParams.set('code_challenge_method', 'S256');
  }
  // `link` is only an intent flag: the callback re-authenticates the session cookie itself
  // rather than trusting any user id stored here.
  const payload = Buffer.from(JSON.stringify({ s: state, v: verifier, p: p.id, link })).toString('base64url');
  addCookie(res, serializeCookie(OAUTH_COOKIE, payload, { maxAge: 600, path: '/auth', secure: config.secureCookies }));
  redirect(res, u.toString());
}

async function finishOAuth(req, res, p, url) {
  const fail = (reason, detail) => {
    if (detail) console.error(`[auth] ${p.id} callback fallito (${reason}): ${detail}`);
    redirect(res, `/?auth_error=${reason}`);
  };
  const raw = parseCookies(req)[OAUTH_COOKIE];
  addCookie(res, serializeCookie(OAUTH_COOKIE, '', { maxAge: 0, path: '/auth', secure: config.secureCookies })); // single use
  let saved;
  try { saved = JSON.parse(Buffer.from(raw || '', 'base64url').toString('utf8')); } catch (e) { saved = null; }
  if (!saved || saved.p !== p.id) return fail('state');
  if (url.searchParams.get('error')) return fail(url.searchParams.get('error') === 'access_denied' ? 'denied' : 'failed');
  const state = url.searchParams.get('state'); const code = url.searchParams.get('code');
  if (!code || !state || !safeEqual(state, saved.s)) return fail('state');
  try {
    const tokens = await exchangeCode(p, code, saved.v);
    if (typeof tokens.access_token !== 'string') throw new Error('nessun access_token');
    const profile = await fetchProfile(p, tokens.access_token);
    if (saved.link) {
      const user = await authenticate(req, res);
      if (!user) return fail('login_required');
      return redirect(res, (await linkIdentity(user.id, p.id, profile)) ? '/#/settings' : '/?auth_error=already_linked#/settings');
    }
    const userId = await findOrCreateUser(p.id, profile);
    await createSession(res, userId);
    redirect(res, '/');
  } catch (e) { fail('failed', e.message); }
}

async function devLogin(req, res) {
  if (!config.devLogin) throw new HttpError(404, 'Non trovato.');
  const body = await readJson(req, 2000);
  const name = cleanName(body.name) || 'Dev';
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'dev';
  const userId = await findOrCreateUser('dev', { id, name, email: null, emailVerified: false, avatar: null });
  await createSession(res, userId);
  sendJson(res, 200, { ok: true });
}

function providersPublic() {
  return { google: config.oauth.google.enabled, facebook: config.oauth.facebook.enabled, dev: config.devLogin };
}

// Routes under /auth/*
async function handle(req, res, url) {
  const m = url.pathname.match(/^\/auth\/(google|facebook)(\/callback)?$/);
  if (m && req.method === 'GET') {
    const p = config.oauth[m[1]];
    if (!p.enabled) return redirect(res, '/?auth_error=not_configured');
    return m[2] ? finishOAuth(req, res, p, url) : startOAuth(req, res, p, url);
  }
  if (url.pathname === '/auth/dev' && req.method === 'POST') return devLogin(req, res);
  throw new HttpError(404, 'Non trovato.');
}

module.exports = { authenticate, destroySession, handle, providersPublic, findOrCreateUser };
