// auth.js — proper embedded-app auth for a single store:
//   • OAuth install flow → offline access token (stored on disk), used for Admin API calls
//   • App Bridge session tokens (JWT) verified on every /api request to authenticate the user
// No shortcuts: Admin calls use the OAuth offline token; requests are authenticated by a
// Shopify-signed session token, verified with the app's API secret.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.SHOPIFY_API_KEY;
const API_SECRET = process.env.SHOPIFY_API_SECRET;
const SHOP = process.env.SHOPIFY_SHOP || process.env.SHOPIFY_STORE; // e.g. bbqing-com.myshopify.com
const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');     // e.g. https://specs.bbqing.com
const SCOPES = process.env.SHOPIFY_SCOPES || 'read_products,write_products';
// On Vercel the project filesystem is read-only; /tmp is the only writable path.
// Local dev keeps using data/token.json so the token survives restarts.
const TOKEN_FILE = process.env.VERCEL
  ? path.join('/tmp', 'bbqing-spec-editor-token.json')
  : path.join(__dirname, '..', 'data', 'token.json');

function need() { if (!API_KEY || !API_SECRET || !APP_URL) throw new Error('Missing SHOPIFY_API_KEY / SHOPIFY_API_SECRET / APP_URL'); }

// ---- offline token storage ----
function saveToken(shop, token) { fs.writeFileSync(TOKEN_FILE, JSON.stringify({ shop, access_token: token }, null, 2), { mode: 0o600 }); }
function loadToken() { try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')); } catch { return null; } }

// ---- OAuth install ----
function installUrl(shop, state) {
  need();
  const p = new URLSearchParams({ client_id: API_KEY, scope: SCOPES, redirect_uri: APP_URL + '/auth/callback', state });
  return `https://${shop}/admin/oauth/authorize?${p.toString()}`;
}
function verifyOAuthHmac(query) {
  const { hmac, signature, ...rest } = query;
  const msg = Object.keys(rest).sort().map(k => `${k}=${Array.isArray(rest[k]) ? rest[k].join(',') : rest[k]}`).join('&');
  const digest = crypto.createHmac('sha256', API_SECRET).update(msg).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(digest, 'utf8'), Buffer.from(String(hmac), 'utf8')); } catch { return false; }
}
async function exchangeCode(shop, code) {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: API_KEY, client_secret: API_SECRET, code }),
  });
  const d = await res.json();
  if (!d.access_token) throw new Error('code exchange failed: ' + JSON.stringify(d));
  return d.access_token;
}

// ---- session token (App Bridge JWT) verification ----
function verifySessionToken(token) {
  need();
  const parts = String(token).split('.');
  if (parts.length !== 3) throw new Error('malformed session token');
  const [h, p, sig] = parts;
  const expected = crypto.createHmac('sha256', API_SECRET).update(h + '.' + p).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new Error('bad session-token signature');
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) throw new Error('session token expired');
  if (payload.nbf && payload.nbf > now + 5) throw new Error('session token not yet valid');
  if (payload.aud !== API_KEY) throw new Error('session token audience mismatch');
  // dest = https://{shop}; make sure it's OUR shop
  const dest = (payload.dest || '').replace(/^https:\/\//, '');
  if (SHOP && dest && dest !== SHOP) throw new Error('session token shop mismatch');
  return payload;
}

// Token exchange: turn a valid App Bridge session token into an offline access token
// (Shopify's recommended embedded-app auth — no OAuth redirect / cookies needed).
async function exchangeToken(shop, sessionToken) {
  need();
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: API_KEY, client_secret: API_SECRET,
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: sessionToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
      requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
    }),
  });
  const d = await res.json();
  if (!d.access_token) throw new Error('token exchange failed: ' + JSON.stringify(d));
  return d.access_token;
}

// Express middleware: require a valid App Bridge session token on /api/*.
// If we don't yet have an offline token, exchange the session token for one and store it.
async function requireSession(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const m = h.match(/^Bearer\s+(.+)$/i);
    if (!m) return res.status(401).json({ error: 'missing session token' });
    const payload = verifySessionToken(m[1]);
    if (!loadToken()) {
      const shop = (payload.dest || '').replace(/^https:\/\//, '') || SHOP;
      const token = await exchangeToken(shop, m[1]);
      saveToken(shop, token);
    }
    next();
  } catch (e) { res.status(401).json({ error: 'unauthorized: ' + e.message }); }
}

module.exports = {
  API_KEY, SHOP, APP_URL,
  installUrl, verifyOAuthHmac, exchangeCode, saveToken, loadToken,
  verifySessionToken, requireSession,
};
