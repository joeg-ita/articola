// Articola server: static frontend + JSON API + OAuth login, backed by PostgreSQL.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./server/config');
const db = require('./server/db');
const auth = require('./server/auth');
const api = require('./server/api');
const llm = require('./server/llm');
const { HttpError, sendJson } = require('./server/http');
const i18n = require('./server/i18n');

const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2',
};

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)');
  if (config.secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
}

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Metodo non consentito.');
  let rel;
  try { rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname); } catch (e) { throw new HttpError(400, 'URL non valido.'); }
  if (rel.includes('\0')) throw new HttpError(400, 'URL non valido.');
  const file = path.normalize(path.join(PUBLIC, rel));
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) throw new HttpError(403, 'Vietato.');
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Non trovato'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

async function handle(req, res) {
  const url = new URL(req.url, config.baseUrl);
  securityHeaders(res);
  if (url.pathname === '/healthz') {
    try { await db.query('SELECT 1'); return sendJson(res, 200, { status: 'ok' }); }
    catch (e) { return sendJson(res, 503, { status: 'db_unavailable' }); }
  }
  if (url.pathname.startsWith('/auth/')) {
    // The app-login confirmation is a plain HTML form: it is protected by its own SameSite cookie instead.
    const formPost = url.pathname === '/auth/app/confirm';
    if (req.method !== 'GET' && !formPost && !req.headers['x-articola']) throw new HttpError(403, 'Richiesta non valida.');
    return auth.handle(req, res, url);
  }
  if (url.pathname.startsWith('/api/')) return api.handle(req, res, url);
  return serveStatic(req, res, url.pathname);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    const status = e instanceof HttpError ? e.status : 500;
    if (status >= 500) console.error(`[err] ${req.method} ${req.url.split('?')[0]}:`, e.message);
    if (res.headersSent) return res.end();
    // Never leak internals (SQL errors, stack traces) to the client.
    const lang = i18n.reqLang(req);
    sendJson(res, status, e instanceof HttpError ? Object.assign({ error: i18n.tr(lang, e.message) }, e.code ? { code: e.code } : {}) : { error: i18n.tr(lang, 'Errore interno del server.') });
  });
});
server.requestTimeout = 240000; // evaluations wait for the model

async function main() {
  await db.waitForDb();
  await db.migrate();
  await db.cleanup();
  const sweep = setInterval(db.cleanup, 6 * 3600 * 1000); sweep.unref();
  server.listen(config.port, () => {
    console.log(`Articola in ascolto su ${config.baseUrl}  (porta ${config.port}, AI: ${llm.PROVIDER} / ${llm.MODEL}${config.stt.enabled ? ', trascrizione sul server: ' + config.stt.model : ''})`);
    const o = config.oauth;
    console.log(`Login: google ${o.google.enabled ? 'attivo' : 'non configurato'}, facebook ${o.facebook.enabled ? 'attivo' : 'non configurato'}`);
    if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(config.baseUrl) && (o.google.enabled || o.facebook.enabled)) {
      console.warn(`⚠ BASE_URL è ${config.baseUrl}: i login Google/Facebook rimandano a quell'indirizzo. Se l'app è pubblicata, imposta BASE_URL con il suo indirizzo https:// (es. https://articola.example.com) e ricrea i container (docker compose up -d); altrimenti vedrai "redirect_uri_mismatch" e i cookie di sessione non saranno Secure.`);
    }
    if (config.devLoginRequested && !config.devLogin) console.warn('⚠ ENABLE_DEV_LOGIN=true IGNORATO perché NODE_ENV=production. Per lo sviluppo locale imposta NODE_ENV=development nel .env.');
    if (config.devLogin) console.warn('⚠ ENABLE_DEV_LOGIN attivo: chiunque può entrare con un nome qualsiasi. Solo per sviluppo locale.');
    if (!o.google.enabled && !o.facebook.enabled && !config.devLogin) console.warn('⚠ nessun provider di login configurato: vedi .env.example');
    if (llm.PROVIDER === 'anthropic' ? !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN : !process.env.OPENAI_API_KEY && !/localhost|127\.0\.0\.1|host\.docker\.internal/.test(config.llm.openaiBaseUrl)) console.warn('⚠ nessuna API key AI configurata: vedi .env.example');
  });
}

function shutdown(signal) {
  console.log(`${signal} ricevuto, chiudo…`);
  server.close(() => db.pool.end().then(() => process.exit(0), () => process.exit(1)));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch((e) => { console.error('Avvio fallito:', e.message); process.exit(1); });
