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
const { HttpError, redirect, readJson, readBody, sendJson, parseCookies, serializeCookie, addCookie } = require('./http');

// __Host- prefix (Secure, Path=/, no Domain) is only valid over HTTPS.
const SESSION_COOKIE = config.secureCookies ? '__Host-ar_sid' : 'ar_sid';
const OAUTH_COOKIE = 'ar_oauth';
const APP_COOKIE = 'ar_app'; // lets only the browser that just signed in confirm a mobile-app login
const APP_HASH_RE = /^[A-Za-z0-9_-]{43}$/; // base64url(sha256(secret)) from the app
const BEARER_RE = /^Bearer ([A-Za-z0-9_-]{20,200})$/;

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

async function newSessionToken(userId) {
  const token = randomToken();
  await db.query('INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + $3::interval)',
    [sha256hex(token), userId, sessionLifetime()]);
  return token;
}

async function createSession(res, userId) {
  addCookie(res, sessionCookie(await newSessionToken(userId))); // a fresh token on every login also prevents session fixation
}

// The mobile app sends its session token as "Authorization: Bearer …"; the website uses the cookie.
function requestToken(req) {
  const m = BEARER_RE.exec(String(req.headers.authorization || ''));
  if (m) return { token: m[1], bearer: true };
  const c = parseCookies(req)[SESSION_COOKIE];
  return c && c.length <= 200 ? { token: c, bearer: false } : null;
}

// Returns the logged-in user (or null). Sessions are sliding: used for at least a day, they are
// extended so an active user is not logged out mid-use.
async function authenticate(req, res) {
  const got = requestToken(req);
  if (!got) return null;
  const { token } = got;
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
    if (res && !got.bearer) addCookie(res, sessionCookie(token));
  }
  return { id: row.id, name: row.name, email: row.email, avatarUrl: row.avatar_url, preferences: row.preferences, onboarded: row.onboarded };
}

async function destroySession(req, res) {
  const got = requestToken(req);
  if (got) await db.query('DELETE FROM auth_sessions WHERE token_hash = $1', [sha256hex(got.token)]);
  if (!got || !got.bearer) addCookie(res, serializeCookie(SESSION_COOKIE, '', { maxAge: 0, secure: config.secureCookies }));
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
  // Sign-in started by the mobile app: remember the hash of its secret (never the secret itself).
  const app = !link && APP_HASH_RE.test(url.searchParams.get('app') || '') ? url.searchParams.get('app') : null;
  const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'it';
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
  const payload = Buffer.from(JSON.stringify({ s: state, v: verifier, p: p.id, link, a: app, l: lang })).toString('base64url');
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
    if (saved.a && APP_HASH_RE.test(saved.a)) return startAppConfirm(res, userId, saved.a, saved.l === 'en' ? 'en' : 'it');
    await createSession(res, userId);
    redirect(res, '/');
  } catch (e) { fail('failed', e.message); }
}

/* ---------- sign-in from the mobile app ---------- */

// The code both screens show: the first 6 hex digits of sha256(secret). It lets the person check that
// the login they are confirming is the one their own app started (and not a link someone sent them).
const appCode = (hash) => Buffer.from(hash, 'base64url').toString('hex').slice(0, 6).toUpperCase();

const APP_TEXT = {
  it: {
    title: 'Accesso all\'app Articola',
    ask: 'Stai accedendo all\'app Articola. Conferma solo se nell\'app vedi questo codice:',
    confirm: 'Conferma l\'accesso',
    done: 'Fatto: torna all\'app Articola, l\'accesso si completa da solo.',
    expired: 'Questa richiesta di accesso è scaduta o non è valida. Ricomincia dall\'app.',
  },
  en: {
    title: 'Sign in to the Articola app',
    ask: 'You are signing in to the Articola app. Confirm only if the app shows this code:',
    confirm: 'Confirm sign-in',
    done: 'Done: go back to the Articola app, sign-in completes by itself.',
    expired: 'This sign-in request has expired or is not valid. Start again from the app.',
  },
};

function appPage(res, status, lang, body) {
  const T = APP_TEXT[lang];
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${T.title}</title><style>
body{font-family:system-ui,-apple-system,sans-serif;max-width:420px;margin:12vh auto;padding:0 20px;color:#1d1d1f;background:#faf9f7;line-height:1.5}
h1{font-size:1.3rem}.code{font:600 2rem ui-monospace,monospace;letter-spacing:.2em;text-align:center;padding:16px;border:1px solid #ddd;border-radius:12px;background:#fff;margin:20px 0}
button{width:100%;font:inherit;font-weight:600;padding:14px;border:0;border-radius:12px;background:#1d1d1f;color:#fff;cursor:pointer}
@media (prefers-color-scheme:dark){body{background:#151515;color:#eee}.code{background:#222;border-color:#333}button{background:#eee;color:#111}}
</style></head><body><h1>${T.title}</h1>${body}</body></html>`);
}

async function startAppConfirm(res, userId, hash, lang) {
  const nonce = randomToken();
  const ins = await db.query(
    `INSERT INTO app_logins (secret_hash, user_id, confirm_hash, expires_at) VALUES ($1, $2, $3, now() + interval '10 minutes')
     ON CONFLICT (secret_hash) DO NOTHING`, [hash, userId, sha256hex(nonce)]);
  if (!ins.rowCount) return appPage(res, 400, lang, `<p>${APP_TEXT[lang].expired}</p>`); // a secret is single use
  addCookie(res, serializeCookie(APP_COOKIE, nonce, { maxAge: 600, path: '/auth/app', secure: config.secureCookies }));
  redirect(res, `/auth/app/confirm?h=${hash}&lang=${lang}`);
}

async function appConfirm(req, res, url) {
  const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'it';
  const T = APP_TEXT[lang];
  const nonce = parseCookies(req)[APP_COOKIE];
  if (req.method === 'GET') {
    const h = url.searchParams.get('h') || '';
    if (!APP_HASH_RE.test(h) || !nonce) return appPage(res, 400, lang, `<p>${T.expired}</p>`);
    const { rows } = await db.query('SELECT 1 FROM app_logins WHERE secret_hash = $1 AND confirm_hash = $2 AND NOT confirmed AND expires_at > now()', [h, sha256hex(nonce)]);
    if (!rows[0]) return appPage(res, 400, lang, `<p>${T.expired}</p>`);
    return appPage(res, 200, lang, `<p>${T.ask}</p><div class="code">${appCode(h)}</div>
<form method="post" action="/auth/app/confirm?lang=${lang}"><input type="hidden" name="h" value="${h}"><button type="submit">${T.confirm}</button></form>`);
  }
  // POST from the form above. No X-Articola header is possible from a plain form; CSRF is covered by the
  // ar_app cookie (SameSite=Lax, so never sent on a cross-site POST) that must match the row.
  const h = new URLSearchParams((await readBody(req, 1000)).toString('utf8')).get('h') || '';
  addCookie(res, serializeCookie(APP_COOKIE, '', { maxAge: 0, path: '/auth/app', secure: config.secureCookies }));
  if (!APP_HASH_RE.test(h) || !nonce) return appPage(res, 400, lang, `<p>${T.expired}</p>`);
  const upd = await db.query(
    'UPDATE app_logins SET confirmed = true WHERE secret_hash = $1 AND confirm_hash = $2 AND NOT confirmed AND expires_at > now()',
    [h, sha256hex(nonce)]);
  appPage(res, upd.rowCount ? 200 : 400, lang, `<p>${upd.rowCount ? T.done : T.expired}</p>`);
}

// The app polls this with its secret until the browser side is confirmed, then gets a session token.
async function appToken(req, res) {
  const body = await readJson(req, 2000);
  const secret = typeof body.secret === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(body.secret) ? body.secret : null;
  if (!secret) throw new HttpError(400, 'Richiesta non valida.');
  const hash = crypto.createHash('sha256').update(secret).digest('base64url');
  const { rows } = await db.query(
    'DELETE FROM app_logins WHERE secret_hash = $1 AND confirmed AND expires_at > now() RETURNING user_id', [hash]);
  if (rows[0]) return sendJson(res, 200, { status: 'ok', token: await newSessionToken(rows[0].user_id) });
  const pending = await db.query('SELECT 1 FROM app_logins WHERE secret_hash = $1 AND expires_at > now()', [hash]);
  sendJson(res, 200, { status: pending.rows[0] ? 'confirm' : 'waiting' });
}

async function devLogin(req, res) {
  if (!config.devLogin) throw new HttpError(404, 'Non trovato.');
  const body = await readJson(req, 2000);
  const name = cleanName(body.name) || 'Dev';
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'dev';
  const userId = await findOrCreateUser('dev', { id, name, email: null, emailVerified: false, avatar: null });
  if (body.app === true) return sendJson(res, 200, { ok: true, token: await newSessionToken(userId) });
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
  if (url.pathname === '/auth/app/confirm' && (req.method === 'GET' || req.method === 'POST')) return appConfirm(req, res, url);
  if (url.pathname === '/auth/app/token' && req.method === 'POST') return appToken(req, res);
  throw new HttpError(404, 'Non trovato.');
}

module.exports = { authenticate, destroySession, handle, providersPublic, findOrCreateUser };
