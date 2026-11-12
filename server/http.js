// Small HTTP helpers shared by the auth and API layers.
'use strict';

class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; if (code) this.code = code; }
}

function sendJson(res, status, body, headers) {
  const data = JSON.stringify(body);
  res.writeHead(status, Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, headers));
  res.end(data);
}

function redirect(res, location, headers) {
  res.writeHead(302, Object.assign({ location, 'cache-control': 'no-store' }, headers));
  res.end();
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    // Reject early when the client announces an oversized body...
    if (Number(req.headers['content-length']) > limit) { req.resume(); return reject(new HttpError(413, 'Richiesta troppo grande.')); }
    const chunks = []; let size = 0; let tooBig = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { tooBig = true; return; } // ...or keep draining without buffering, so the 413 can still be delivered
      chunks.push(c);
    });
    req.on('end', () => (tooBig ? reject(new HttpError(413, 'Richiesta troppo grande.')) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

async function readJson(req, limit = 400 * 1024) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try {
    const v = JSON.parse(buf.toString('utf8'));
    if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
    return v;
  } catch (e) { throw new HttpError(400, 'JSON non valido.'); }
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim(); const v = part.slice(i + 1).trim();
    if (k) { try { out[k] = decodeURIComponent(v); } catch (e) { out[k] = v; } }
  });
  return out;
}

function serializeCookie(name, value, o = {}) {
  let s = `${name}=${encodeURIComponent(value)}`;
  if (o.maxAge !== undefined) s += `; Max-Age=${Math.floor(o.maxAge)}`;
  s += `; Path=${o.path || '/'}`;
  if (o.httpOnly !== false) s += '; HttpOnly';
  s += `; SameSite=${o.sameSite || 'Lax'}`;
  if (o.secure) s += '; Secure';
  return s;
}

// Several Set-Cookie headers can be queued on one response.
function addCookie(res, cookie) {
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [].concat(prev, cookie) : [cookie]);
}

module.exports = { HttpError, sendJson, redirect, readBody, readJson, parseCookies, serializeCookie, addCookie };
